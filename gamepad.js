class Mapper{
    constructor(type, name, gamepad, control_map, completion_handler){
        this.type = type
        this.name = name
        this.active = false
        this.index = -1
        this.live_index = -1
        this.max_deflection = 0
        this.base = null
        this.invert = false
        this.base_values = {}
        this.control_map = control_map
        for (let i = 0; i < gamepad.axes.length; i++) {
            this.base_values[i] = gamepad.axes[i];
        }
        this.finished = false
        this.completion_handler = completion_handler
    }
    handle_mapping_axis(gamepad){
        if (!this.active) {
            let maxDiff = 0;
            for (let i = 0; i < gamepad.axes.length; i++) {
                const diff = Math.abs(gamepad.axes[i] - this.base_values[i]);
                if(i == 0){
                    console.log(`Axis ${i}: ${gamepad.axes[i]}`);
                }
                if (diff > maxDiff) {
                    maxDiff = diff;
                    this.live_index = i;
                    this.invert = (gamepad.axes[i] - this.base_values[i]) < 0;
                    this.base = this.base_values[i];
                }
                if (diff > 0.5) {
                    this.base = this.base_values[i];
                    this.active = true;
                    this.index = i;
                    const movement = gamepad.axes[i] - this.base_values[i];
                    this.invert = movement < 0;
                    break;
                }
            }
        } else {
            const value = gamepad.axes[this.index];
            const deflection = Math.abs(value - this.base);
            if (deflection > this.max_deflection) {
                this.max_deflection = deflection;
            } 
            if (this.max_deflection - deflection > 0.1){
                this.finished = true
            }
        }
        // live_view
        const was_not_mapped = this.control_map[this.name] === undefined;
        this.control_map[this.name] = { 
            type: 'axis', 
            index: this.active ? this.index : this.live_index, 
            invert: this.invert,
            base: this.base,
            max_deflection: this.max_deflection,
            finished: this.finished
        };
        if(this.finished){
            this.completion_handler();
        }
        return was_not_mapped
    }
    handle_mapping_button(gamepad){
        for (let i = 0; i < gamepad.buttons.length; i++) {
            if (gamepad.buttons[i].pressed) {
                this.control_map[this.name] = { type: 'button', index: i};
                this.completion_handler()
                return false;
            }
        }
        return false
    }
    handle_mapping(gamepad){
        if(this.type === 'axis'){
            return this.handle_mapping_axis(gamepad);
        } else if(this.type === 'button'){
            return this.handle_mapping_button(gamepad);
        }
    }
}
export class Gamepad{
    constructor(element, gamepad_interface){
        // const template = document.getElementById('gamepad-template');
        // const clone = template.content.cloneNode(true);
        // parent.appendChild(clone);
        this.element = element; //parent.lastElementChild;
        this.gamepad_interface = gamepad_interface;
        this.mapper = null;
        this.control_map = {}
        this.callbacks = {}
        this.expo_sliders = {}
        this.gamepad_index = null
        this.gamepad_poller = null
        this.expo_curve = (x, expo) => {
            return (1-expo)*x + expo * Math.pow(x, 3)
        }
        const reset_button = document.createElement('button');
        reset_button.classList.add('gamepad-mapping-button');
        reset_button.classList.add('gamepad-button');
        reset_button.classList.add('gamepad-reset-button')
        reset_button.textContent = "Reset";
        reset_button.onclick = () => {
            const gamepad = this.get_gamepad();
            if(gamepad === null) return;
            this.gamepad_index = null
            this.control_map = {}
            this.callbacks = {}
            const status_element = document.getElementById('gamepad-status');
            status_element.textContent = 'No gamepad connected';
            status_element.className = 'gamepad-disconnected';
            this.reset_config(gamepad.id)
            document.querySelectorAll('.gamepad-mapping-button').forEach((btn) => { btn.disabled = true; });
            this.render_live_view()
        };
        const button_container = document.getElementById("gamepad-button-container")
        button_container.innerHTML = '';
        button_container.appendChild(reset_button);


        for (const channel in gamepad_interface){
            const details = gamepad_interface[channel];
            const button = document.createElement('button');
            // <button class="gamepad-mapping-button" disabled onclick="startMapping('thrust', 'axis', 'up', this)">Map Thrust Axis</button>
            button.classList.add('gamepad-mapping-button');
            button.classList.add('gamepad-button');
            const default_text = `Map ${channel}`
            button.textContent = default_text;
            button.disabled = true;
            button.onclick = () => {
                button.textContent = details.type === "button" ? 'Press Button' : `Move ${details.positive_direction}`;
                document.querySelectorAll('.gamepad-mapping-button').forEach((btn) => { btn.disabled = true; });
                button.disabled = false;
                const gamepad = this.get_gamepad();
                if(this.mapper === null && gamepad !== null){
                    this.mapper = new Mapper(details.type, channel, gamepad, this.control_map, () => {
                        button.textContent = default_text
                        document.querySelectorAll('.gamepad-mapping-button').forEach((btn) => { btn.disabled = false; });
                        this.mapper = null
                        this.save_config(gamepad.id)
                        this.render_live_view()
                    });
                }
            };
            button_container.appendChild(button);
        }
        this.listeners = []
        this.poll()
    }
    load_config(id){
        let gamepad_config = localStorage.getItem('gamepad_config');
        gamepad_config = gamepad_config !== null ? JSON.parse(gamepad_config) : {};
        gamepad_config = id in gamepad_config ? gamepad_config[id] : null;
        return gamepad_config
    }
    reset_config(id){
        let gamepad_config = localStorage.getItem('gamepad_config');
        gamepad_config = gamepad_config !== null ? JSON.parse(gamepad_config) : null;
        if(gamepad_config !== null){
            delete gamepad_config[id];
            localStorage.setItem('gamepad_config', JSON.stringify(gamepad_config));
        }
    }
    save_config(id){
        let gamepad_config = localStorage.getItem('gamepad_config');
        gamepad_config = gamepad_config !== null ? JSON.parse(gamepad_config) : {};
        gamepad_config[id] = this.control_map;
        localStorage.setItem('gamepad_config', JSON.stringify(gamepad_config));
    }
    get_gamepad(){
        if(this.gamepad_index === null){
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            let new_gamepad = null
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if(gp){
                    this.gamepad_index = gp.index;
                    const status_element = document.getElementById('gamepad-status');
                    status_element.textContent = 'Gamepad connected: ' + gp.id;
                    status_element.className = 'gamepad-connected';
                    document.querySelectorAll('.gamepad-mapping-button').forEach((btn) => { btn.disabled = false; });
                    const gamepad_config = this.load_config(gp.id);
                    if(gamepad_config !== null){
                        this.control_map = gamepad_config;
                        this.render_live_view()
                    }
                    break;
                }
            }
        }
        return this.gamepad_index !== null ? navigator.getGamepads()[this.gamepad_index] : null;
    }
    render_live_view(){
        const gamepad_state = document.getElementById('gamepad-state');
        gamepad_state.innerHTML = '';
        this.callbacks = {}
        this.expo_sliders = {}
        for (const control in this.control_map){
            const details = this.control_map[control];
            const template = document.getElementById(details.type === 'axis' ? 'gamepad-axis-template' : 'gamepad-button-template');
            const clone = template.content.cloneNode(true);
            gamepad_state.appendChild(clone);
            const name = gamepad_state.lastElementChild.querySelector('.gamepad-controls-name');
            name.textContent = control
            const element = gamepad_state.lastElementChild
            let expo_plot = null
            if(details.type === 'axis'){
                const expo_canvas = element.querySelector('.gamepad-expo-canvas');
                const expo_slider = element.querySelector('.gamepad-slider-expo')
                this.expo_sliders[control] = expo_slider;
                expo_slider.addEventListener('input', (event) => {
                    
                })
                expo_plot = new ExpoPlot(expo_canvas, this.expo_curve);
            }
            this.callbacks[control] = (value_raw) =>{
                const slider = element.querySelector('.gamepad-slider');
                const valueDisplay = element.querySelector('.gamepad-value-display');
                if (details.type === 'axis') {
                    slider.value = value_raw;
                    const processed_value = this.expo_curve(value_raw, this.expo_sliders[control].value);
                    console.log(`${control} value: ${processed_value}`);
                    valueDisplay.textContent = processed_value.toFixed(2);
                    expo_plot.draw(value_raw, this.expo_sliders[control].value);
                } else {
                    const buttonIndicator = element.querySelector('.gamepad-button-indicator');
                    buttonIndicator.style.backgroundColor = value_raw ? '#28a745' : '#ccc';
                    valueDisplay.textContent = value_raw ? 'Pressed' : 'Released';
                }
            };
        }
    }
    poll(){
        requestAnimationFrame(this.poll.bind(this));
        const gamepad = this.get_gamepad();
        if(gamepad){
            if(this.mapper){
                const should_render = this.mapper.handle_mapping(gamepad);
                if(should_render){
                    this.render_live_view();
                }
            }
            const output = {}
            for(const control in this.control_map){
                const details = this.control_map[control];
                if(details.index === -1) continue;
                const raw_value = gamepad[details.type === 'axis' ? 'axes' : 'buttons'][details.index];
                if(details.type === 'axis'){
                    const value = (raw_value - details.base);
                    const value_clipped = Math.max(-1, Math.min(1, value));
                    const value_inverted = details.invert ? -value_clipped : value_clipped;
                    const value_transformed = this.expo_curve(value_inverted, this.expo_sliders[control].value);
                    output[control] = value_transformed;
                    this.callbacks[control](value_inverted);
                }
                else{
                    output[control] = raw_value.pressed;
                    this.callbacks[control](raw_value.pressed);
                }
            }
            if((Object.keys(this.gamepad_interface).every((key) => key in output && this.control_map[key].index !== -1))){
                for(const listener of this.listeners){
                    listener(output);
                }
            }
        }
    }
    addListener(listener){
        this.listeners.push(listener);
    }
}


class ExpoPlot{
    constructor(canvas, mapping){
        this.canvas = canvas
        this.mapping = mapping
        const ctx = canvas.getContext("2d");
    }
    draw(x, expo) {
        const ctx = this.canvas.getContext("2d");
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Draw axes
        ctx.strokeStyle = "#ccc";
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w / 2, h);
        ctx.stroke();

        // Draw expo curve
        ctx.strokeStyle = "blue";
        ctx.beginPath();
        for (let i = 0; i <= w; i++) {
            const x_norm = (i / w) * 2 - 1; // normalize to [-1, 1]
            const y_val = this.mapping(x_norm, expo);
            const y_pix = h / 2 - y_val * (h / 2);
            if (i === 0) ctx.moveTo(i, y_pix);
            else ctx.lineTo(i, y_pix);
        }
        ctx.stroke();

        // Draw current position dot and projections
        const x_pix = w / 2 + x * (w / 2);
        const y_val = this.mapping(x, expo);
        const y_pix = h / 2 - y_val * (h / 2);

        ctx.strokeStyle = "#999";
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(x_pix, h / 2);
        ctx.lineTo(x_pix, y_pix);
        ctx.moveTo(w / 2, y_pix);
        ctx.lineTo(x_pix, y_pix);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(x_pix, y_pix, 4, 0, 2 * Math.PI);
        ctx.fill();
    }
}