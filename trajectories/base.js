export class Trajectory{
    constructor(parameters){
        this.parameters = parameters
        this.parameter_values = {}
        for(const [name, param] of Object.entries(this.parameters)){
            this.parameter_values[name] = param.default
        }
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
}