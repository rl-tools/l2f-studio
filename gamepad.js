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
        this.listeners = []
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
        this.gamepad_index = null
        this.gamepad_poller = null
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
            let gamepad_config = localStorage.getItem('gamepad_config');
            gamepad_config = gamepad_config !== null ? JSON.parse(gamepad_config) : null;
            if(gamepad_config !== null){
                delete gamepad_config[gamepad.id];
                localStorage.setItem('gamepad_config', JSON.stringify(gamepad_config));
            }
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
                        // localStorage.setItem('quadrotorGamepadMap', JSON.stringify(controlMap));
                        document.querySelectorAll('.gamepad-mapping-button').forEach((btn) => { btn.disabled = false; });
                        this.mapper = null
                        let gamepad_config = localStorage.getItem('gamepad_config');
                        gamepad_config = gamepad_config !== null ? JSON.parse(gamepad_config) : {};
                        gamepad_config[gamepad.id] = this.control_map;
                        localStorage.setItem('gamepad_config', JSON.stringify(gamepad_config));
                        this.render_live_view()
                    });
                }
            };
            button_container.appendChild(button);
        }
        this.poll()
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
                    let gamepad_config = localStorage.getItem('gamepad_config');
                    gamepad_config = gamepad_config !== null ? JSON.parse(gamepad_config) : {};
                    gamepad_config = gp.id in gamepad_config ? gamepad_config[gp.id] : null;
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
        for (const control in this.control_map){
            const details = this.control_map[control];
            const template = document.getElementById(details.type === 'axis' ? 'gamepad-axis-template' : 'gamepad-button-template');
            const clone = template.content.cloneNode(true);
            gamepad_state.appendChild(clone);
            const name = gamepad_state.lastElementChild.querySelector('.gamepad-controls-name');
            name.textContent = control
            const element = gamepad_state.lastElementChild
            this.callbacks[control] = (value) =>{
                const slider = element.querySelector('.gamepad-slider');
                const valueDisplay = element.querySelector('.gamepad-value-display');
                if (details.type === 'axis') {
                    slider.value = value;
                    console.log(`${control} value: ${value}`);
                    valueDisplay.textContent = value.toFixed(2);
                } else {
                    const buttonIndicator = element.querySelector('.gamepad-button-indicator');
                    buttonIndicator.style.backgroundColor = value ? '#28a745' : '#ccc';
                    valueDisplay.textContent = value ? 'Pressed' : 'Released';
                }
            };
        }
    }
    update_live_view(gamepad){
        for (const control in this.control_map) {
            const details = this.control_map[control];
            if(details.index === -1) continue;
            const raw_value = gamepad[details.type === 'axis' ? 'axes' : 'buttons'][details.index];
            if(details.type === 'axis'){
                const value = (raw_value - details.base);
                const value_clipped = Math.max(-1, Math.min(1, value));
                const value_inverted = details.invert ? -value_clipped : value_clipped;
                this.callbacks[control](value_inverted);
            }
            else{
                this.callbacks[control](raw_value.pressed);
            }
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
            this.update_live_view(gamepad)
            if((Object.keys(this.gamepad_interface).map((key) => key in this.control_map && this.control_map[key].index !== -1)).every()){
                const output = {}
                for(const control in this.control_map){
                    const details = this.control_map[control];
                    const raw_value = gamepad[details.type === 'axis' ? 'axes' : 'buttons'][details.index];
                    if(details.type === 'axis'){
                        const value = (raw_value - details.base);
                        const value_clipped = Math.max(-1, Math.min(1, value));
                        const value_inverted = details.invert ? -value_clipped : value_clipped;
                        output[control] = value_inverted;
                    }
                    else{
                        output[control](raw_value.pressed);
                    }
                }
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