export class Position{
    constructor(){
        this.parameters = {
            "x": {"range": [-10, 10], "default": 0},
            "y": {"range": [-10, 10], "default": 0},
            "z": {"range": [-10, 10], "default": 0},
        }
        this.parameter_values = {}
        for(const [name, param] of Object.entries(this.parameters)){
            this.parameter_values[name] = param.default
        }
    }
    set_parameter(name, value){
        this.parameter_values[name] = value
    }
    evaluate(t){
        return [this.parameter_values.x, this.parameter_values.y, this.parameter_values.z, 0, 0, 0]
    }
}

// function lissajous(t){
//     const scale = 0.5
//     const duration = 10
//     const A = 1
//     const B = 0.5
//     const progress = t * 2 * Math.PI / duration
//     const d_progress = 2 * Math.PI / duration
//     const x = scale * Math.sin(A * progress)
//     const y = scale * Math.sin(B * progress)
//     const vx = scale * Math.cos(A * progress) * A * d_progress
//     const vy = scale * Math.cos(B * progress) * B * d_progress
//     return [x, y, 0, vx, vy, 0]
// }