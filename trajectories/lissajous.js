import { Trajectory } from "./base.js"
export class Lissajous extends Trajectory{
    constructor(){
        super({
            "period": {"range": [1, 15], "default": 10},
            "scale": {"range": [0, 5], "default": 0.1},
            "A": {"range": [-1, 1], "default": 1},
            "B": {"range": [-1, 1], "default": 0.5},
            "a": {"range": [0, 1], "default": 1},
            "b": {"range": [0, 1], "default": 2},
            "delta": {"range": [0, 1], "default": 0.5},
            "phase": {"range": [0, 1], "default": 0.5},
        })
    }
    evaluate(t){
        const scale = this.parameter_values.scale
        const duration = this.parameter_values.period
        const A = this.parameter_values.A
        const B = this.parameter_values.B
        const a = this.parameter_values.a
        const b = this.parameter_values.b
        const delta = this.parameter_values.delta
        const phase = this.parameter_values.phase
        const progress = t * 2 * Math.PI / duration
        const d_progress = 2 * Math.PI / duration
        const x = scale * A * Math.sin(a * (phase*Math.PI + progress) + delta*Math.PI)
        const y = scale * B * Math.sin(b * (phase*Math.PI + progress))
        const vx = scale * A * Math.cos(a * (phase*Math.PI + progress) + delta*Math.PI) * a * d_progress
        const vy = scale * B * Math.cos(b * (phase*Math.PI + progress)) * b * d_progress
        return [x, y, 0, vx, vy, 0]
    }
}