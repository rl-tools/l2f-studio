import { Trajectory } from "./base.js"
export class Lissajous extends Trajectory{
    constructor(){
        super({
            "period": {"range": [1, 15], "default": 10},
            "scale": {"range": [0, 5], "default": 0.1},
        })
    }
    evaluate(t){
        const scale = this.parameter_values.scale
        const duration = this.parameter_values.period
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
}