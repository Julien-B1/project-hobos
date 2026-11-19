/**
 * Application entry point: mounts the Vue shell.
 *
 * Layer: app. The 3D engine is created by the shell components, not here.
 */
import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

createApp(App).mount('#app')
