"""
The fighter model, brought to the reference skeleton (humanoid.py).

Usage (in the dev container, see `make models`):
    blender -b --python tooling/blender/fighter.py -- in.glb out.glb
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import humanoid  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1 :]
humanoid.load_normalised(ARGS[0])
humanoid.export_model(ARGS[1])
