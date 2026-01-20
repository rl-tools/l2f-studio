export class Trajectory{
    constructor(parameters){
        this.parameters = parameters
        this.parameter_values = {}
        for(const [name, param] of Object.entries(this.parameters)){
            this.parameter_values[name] = param.default
        }
        this.length = 10 // seconds
        this.sample_rate = 100 // Hz = control frequency
        this.num_steps = this.length * this.sample_rate
        this.parameters_updated()
    }
    set_parameter(name, value){
        this.parameter_values[name] = value
    }
    reset(){
        this.parameter_values = {}
        for(const [name, param] of Object.entries(this.parameters)){
            this.parameter_values[name] = param.default
        }
    }
    parameters_updated(){
        this.trajectory = new Array(this.num_steps).fill(0).map((_, i) => {
            return this.evaluate(i / this.sample_rate)
        })
    }
}