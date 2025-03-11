import {L2F} from "./l2f.js"
import { SimControls } from "./sim_controls.js";
import { ParameterManager } from "./parameter_manager.js";
import * as rlt from "rltools"
import * as math from "mathjs"

// check url for "file" parameter
const urlParams = new URLSearchParams(window.location.search);
const file = urlParams.get('file');
const file_url = file ? file : "./blob/checkpoint.h5"

let model = null

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary); // Base64 encode the binary string
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64); // Decode Base64 to binary string
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer; // Return the ArrayBuffer
}

function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.style.display = 'block';
    status.className = `status ${isError ? 'error' : 'success'}`;
    setTimeout(() => status.style.display = 'none', 3000);
}

async function main(){
    const seed = 12
    if(model === null){
        let checkpoint = null
        if(localStorage.getItem("checkpoint") !== null){
            console.log("loading checkpoint from local storage")
            checkpoint = base64ToArrayBuffer(localStorage.getItem("checkpoint"))
        }
        else{
            console.log(`Loading checkpoint from ${file_url}`)
            checkpoint = await (await fetch(file_url)).arrayBuffer()
            localStorage.setItem("checkpoint", arrayBufferToBase64(checkpoint))
        }
        model = await rlt.load(checkpoint)
        document.getElementById("checkpoint-name").textContent = model.checkpoint_name
    }
    const policy_state = {
        "step": 0
    }
    function lissajous(t){
        const scale = 0.5
        const duration = 10
        const A = 1
        const B = 0.5
        const progress = t * 2 * Math.PI / duration
        const d_progress = 2 * Math.PI / duration
        const x = scale * Math.sin(A * progress)
        const y = scale * Math.sin(B * progress)
        const vx = scale * Math.cos(A * progress) * A * d_progress
        const vy = scale * Math.cos(B * progress) * B * d_progress
        return [x, y, 0, vx, vy, 0]
    }
    function default_trajectory(t){
        return [0, 0, 0, 0, 0, 0]
    }
    function policy(state){
        state.observe()
        const input = math.matrix([[[...Array(model.input_shape[2]).keys()].map(i => state.get_observation(i))]])
        const input_offset = default_trajectory(policy_state.step / 100)
        input_offset.forEach((x, i) => {
            input._data[0][0][i] = input._data[0][0][i] - x
        })
        const output = model.evaluate(input)
        policy_state.step += 1
        return output.valueOf()[0][0]
    }
    const sim_container = document.getElementById("sim-container")
    const l2f = new L2F(sim_container, 10, policy, seed)

    const sim_controls = new SimControls(l2f)
    const parameter_manager = new ParameterManager(l2f)

}
window.onload = main

const drag_and_drop_overlay = document.getElementById('drag-and-drop-overlay');
let drag_and_drop_counter = 0;

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
    document.body.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

document.body.addEventListener('dragenter', () => {
    drag_and_drop_counter++;
    drag_and_drop_overlay.style.display = 'flex';
}, false);

document.body.addEventListener('dragleave', () => {
    drag_and_drop_counter--;
    if (drag_and_drop_counter === 0) {
        drag_and_drop_overlay.style.display = 'none';
    }
}, false);

document.body.addEventListener('drop', e => {
    drag_and_drop_counter = 0;
    drag_and_drop_overlay.style.display = 'none';
    
    const file = e.dataTransfer.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const array_buffer = e.target.result;
            localStorage.setItem("checkpoint", arrayBufferToBase64(array_buffer))
            model = rlt.load(array_buffer)
            document.getElementById("checkpoint-name").textContent = model.checkpoint_name
            console.log("loaded model: ", model.checkpoint_name)
            showStatus(`Loaded model: ${model.checkpoint_name}`);
        };
        reader.readAsArrayBuffer(file);
    }
}, false);

