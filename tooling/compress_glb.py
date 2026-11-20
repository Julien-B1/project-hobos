#!/usr/bin/env python3
"""
Shrink a skinned, animated GLB (characters exported by Tripo / Mixamo).

Usage: python3 -I tooling/compress_glb.py in.glb out.glb [--flat N] [--max-size PX] [--no-animations] [--texture-only]

Needs Python 3 with numpy, and ffmpeg (texture to WebP). Run on the host:
it is a one-off asset step, not part of the build, and the dev image has
no Python. Everything it writes loads with Three.js' stock GLTFLoader (no
decoder to ship):

- animations: channels that never move become a single key; the others
  lose the keys that linear interpolation (spherical for rotations)
  rebuilds within a tolerance; rotations are stored as normalized shorts
  (core glTF);
- mesh: weights as normalized bytes, UVs as normalized shorts (core glTF),
  normals as normalized bytes (KHR_mesh_quantization);
- with `--no-animations`, the clips are dropped (characters take theirs
  from the shared animation library, `make models`);
- texture: JPEG to WebP (EXT_texture_webp), at most `--max-size` pixels
  wide when given (area downscale); with `--flat N`, first turned
  into flat colours for cel shading (edge-preserving smoothing, then N
  colours without dithering: the painted shading becomes plain areas).
Positions, joints and indices are kept as they are.

With `--texture-only`, only the texture step runs: the geometry and the
animations are copied untouched, for `gltfpack` to compress next (meshopt,
`make models`), which does better than the steps above.
"""
import json
import struct
import subprocess
import sys
import tempfile

import numpy as np

# Largest error a removed key may introduce: rotation, as the dot product
# deficit of unit quaternions (1e-6 is about 0.16 degree); translation and
# scale, in model units (the model is about 1 unit tall).
ROTATION_TOLERANCE = 1e-6
LINEAR_TOLERANCE = 5e-4
WEBP_QUALITY = 82

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
CODES = {np.dtype(v): k for k, v in DTYPES.items()}


def load(path):
    data = open(path, "rb").read()
    json_len = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20 : 20 + json_len])
    binary = data[20 + json_len + 8 :]
    return gltf, binary


def read(gltf, binary, index):
    accessor = gltf["accessors"][index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    n = COMPONENTS[accessor["type"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    array = np.frombuffer(binary, DTYPES[accessor["componentType"]], accessor["count"] * n, offset)
    return array.reshape(accessor["count"], n).copy()


class Writer:
    """Accumulates a new binary chunk, bufferViews and accessors."""

    def __init__(self):
        self.chunks = []
        self.length = 0
        self.views = []
        self.accessors = []

    def view(self, raw, target=None):
        pad = (-self.length) % 4
        self.chunks.append(b"\0" * pad)
        self.length += pad
        view = {"buffer": 0, "byteOffset": self.length, "byteLength": len(raw)}
        if target:
            view["target"] = target
        self.chunks.append(raw)
        self.length += len(raw)
        self.views.append(view)
        return len(self.views) - 1

    def accessor(self, array, kind, normalized=False, target=None, bounds=False):
        array = np.ascontiguousarray(array)
        acc = {
            "bufferView": self.view(array.tobytes(), target),
            "componentType": CODES[array.dtype],
            "count": int(array.shape[0]),
            "type": kind,
        }
        if normalized:
            acc["normalized"] = True
        if bounds:
            acc["min"] = array.min(axis=0).tolist()
            acc["max"] = array.max(axis=0).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1


def slerp(a, b, t):
    dot = float(np.dot(a, b))
    if dot < 0:
        b, dot = -b, -dot
    if dot > 0.9995:
        q = a + (b - a) * t
    else:
        theta = np.arccos(dot)
        q = (np.sin((1 - t) * theta) * a + np.sin(t * theta) * b) / np.sin(theta)
    return q / np.linalg.norm(q)


def error(times, values, i, j, k, rotation):
    """Error at key k when it is rebuilt from keys i and j."""
    t = (times[k] - times[i]) / (times[j] - times[i])
    if rotation:
        q = slerp(values[i], values[j], t)
        return 1 - abs(float(np.dot(q, values[k])))
    return float(np.abs(values[i] + (values[j] - values[i]) * t - values[k]).max())


def reduce_keys(times, values, rotation):
    """Indices of the keys to keep (greedy: extend each segment while it fits)."""
    tolerance = ROTATION_TOLERANCE if rotation else LINEAR_TOLERANCE
    keep = [0]
    i = 0
    while i < len(times) - 1:
        j = i + 1
        while j + 1 < len(times) and all(error(times, values, i, j + 1, k, rotation) <= tolerance for k in range(i + 1, j + 1)):
            j += 1
        keep.append(j)
        i = j
    return keep


def webp(jpeg, flat=None, max_size=None):
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = f"{tmp}/in.jpg", f"{tmp}/out.webp"
        open(src, "wb").write(jpeg)
        command = ["ffmpeg", "-loglevel", "error", "-i", src]
        # Downscale first (area average), keeping the aspect ratio.
        scale = f"scale='min(iw,{max_size})':-1:flags=area," if max_size else ""
        if flat:
            command += [
                "-filter_complex",
                f"{scale}bilateral=sigmaS=6:sigmaR=0.12,split[a][b];"
                f"[a]palettegen=max_colors={flat}:stats_mode=full:reserve_transparent=0[p];"
                "[b][p]paletteuse=dither=none,median=radius=1,format=rgb24",
            ]
        elif scale:
            command += ["-vf", scale.rstrip(",")]
        command += ["-quality", str(WEBP_QUALITY), dst]
        subprocess.run(command, check=True)
        return open(dst, "rb").read()


def texture_only(gltf, binary, flat, max_size=None):
    """Copy every buffer view as it is, except the images (flattened, WebP)."""
    out = Writer()
    images = {image["bufferView"]: image for image in gltf.get("images", [])}
    for index, view in enumerate(gltf["bufferViews"]):
        raw = binary[view.get("byteOffset", 0) : view.get("byteOffset", 0) + view["byteLength"]]
        image = images.get(index)
        if image is not None and image.get("mimeType") == "image/jpeg":
            raw = webp(raw, flat, max_size)
            image["mimeType"] = "image/webp"
        out.view(raw, view.get("target"))
        if "byteStride" in view:
            out.views[-1]["byteStride"] = view["byteStride"]
    if any(i.get("mimeType") == "image/webp" for i in images.values()):
        used = set(gltf.get("extensionsUsed", [])) | {"EXT_texture_webp"}
        gltf["extensionsUsed"] = sorted(used)
        gltf["extensionsRequired"] = sorted(set(gltf.get("extensionsRequired", [])) | {"EXT_texture_webp"})
        for texture in gltf.get("textures", []):
            if "source" in texture:
                texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": texture.pop("source")}
    return out


def write(gltf, out, dst):
    gltf["bufferViews"] = out.views
    if out.accessors:
        gltf["accessors"] = out.accessors
    blob = b"".join(out.chunks)
    blob += b"\0" * ((-len(blob)) % 4)
    gltf["buffers"] = [{"byteLength": len(blob)}]
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * ((-len(text)) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)
    return total


def main(src, dst, flat=None, only_texture=False, max_size=None, no_animations=False):
    gltf, binary = load(src)
    if no_animations:
        # Clips come from the shared library; gltfpack drops the orphan data.
        gltf.pop("animations", None)
    if only_texture:
        total = write(gltf, texture_only(gltf, binary, flat, max_size), dst)
        print(f"{src}: texture only -> {dst}: {total} bytes")
        return
    out = Writer()

    # Mesh attributes.
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            for name, index in list(attrs.items()):
                values = read(gltf, binary, index)
                kind = gltf["accessors"][index]["type"]
                if name == "NORMAL":
                    q = np.round(np.clip(values, -1, 1) * 127).astype(np.int8)
                    attrs[name] = out.accessor(q, kind, normalized=True, target=34962)
                elif name.startswith("TEXCOORD") and values.min() >= 0 and values.max() <= 1:
                    q = np.round(values * 65535).astype(np.uint16)
                    attrs[name] = out.accessor(q, kind, normalized=True, target=34962)
                elif name.startswith("WEIGHTS"):
                    w = values / np.maximum(values.sum(axis=1, keepdims=True), 1e-9)
                    q = np.floor(w * 255).astype(np.int32)
                    # Hand the rounding remainder to the largest weight: sums stay 255.
                    q[np.arange(len(q)), w.argmax(axis=1)] += 255 - q.sum(axis=1)
                    attrs[name] = out.accessor(q.astype(np.uint8), kind, normalized=True, target=34962)
                else:
                    attrs[name] = out.accessor(values, kind, target=34962, bounds=name == "POSITION")
            if "indices" in prim:
                values = read(gltf, binary, prim["indices"]).reshape(-1)
                if values.max() < 65536:
                    values = values.astype(np.uint16)
                prim["indices"] = out.accessor(values, "SCALAR", target=34963)

    for skin in gltf.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = out.accessor(read(gltf, binary, skin["inverseBindMatrices"]), "MAT4")

    # Animations.
    for anim in gltf.get("animations", []):
        samplers = []
        for channel in anim["channels"]:
            sampler = anim["samplers"][channel["sampler"]]
            times = read(gltf, binary, sampler["input"]).reshape(-1)
            values = read(gltf, binary, sampler["output"]).astype(np.float64)
            rotation = channel["target"]["path"] == "rotation"
            if rotation:
                # Keep neighbouring quaternions in the same hemisphere: q and -q
                # are the same rotation, but interpolating between them is not.
                for k in range(1, len(values)):
                    if np.dot(values[k - 1], values[k]) < 0:
                        values[k] = -values[k]
            if np.ptp(values, axis=0).max() < 1e-5:
                keep = [0]
            else:
                keep = reduce_keys(times, values, rotation)
            t = times[keep].astype(np.float32)
            v = values[keep]
            if rotation:
                v = v / np.linalg.norm(v, axis=1, keepdims=True)
                out_index = out.accessor(np.round(v * 32767).astype(np.int16), "VEC4", normalized=True)
            else:
                out_index = out.accessor(v.astype(np.float32), "VEC3")
            in_index = out.accessor(t.reshape(-1, 1), "SCALAR", bounds=True)
            channel["sampler"] = len(samplers)
            samplers.append({"input": in_index, "output": out_index, "interpolation": sampler.get("interpolation", "LINEAR")})
        # The last key of every moving channel is kept: the clip keeps its length.
        anim["samplers"] = samplers

    # Images.
    used = set(gltf.get("extensionsUsed", []))
    for image in gltf.get("images", []):
        view = gltf["bufferViews"][image["bufferView"]]
        raw = binary[view.get("byteOffset", 0) : view.get("byteOffset", 0) + view["byteLength"]]
        if image.get("mimeType") == "image/jpeg":
            raw = webp(raw, flat, max_size)
            image["mimeType"] = "image/webp"
            used.add("EXT_texture_webp")
        image["bufferView"] = out.view(raw)
    if "EXT_texture_webp" in used:
        for texture in gltf.get("textures", []):
            source = texture.pop("source")
            texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": source}
    used.add("KHR_mesh_quantization")
    gltf["extensionsUsed"] = sorted(used)
    gltf["extensionsRequired"] = sorted(used)

    total = write(gltf, out, dst)
    print(f"{src}: {len(open(src, 'rb').read())} bytes -> {dst}: {total} bytes")


if __name__ == "__main__":
    args = sys.argv[1:]
    flat = None
    if "--flat" in args:
        at = args.index("--flat")
        flat = int(args[at + 1])
        del args[at : at + 2]
    max_size = None
    if "--max-size" in args:
        at = args.index("--max-size")
        max_size = int(args[at + 1])
        del args[at : at + 2]
    only_texture = "--texture-only" in args
    if only_texture:
        args.remove("--texture-only")
    no_animations = "--no-animations" in args
    if no_animations:
        args.remove("--no-animations")
    main(args[0], args[1], flat, only_texture, max_size, no_animations)
