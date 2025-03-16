import { vec3, vec4, mat4, quat } from 'https://esm.sh/gl-matrix';

export default class Controller{
    constructor(){
    }
    evaluate_step(state){
        const q_des = [0, 0, 0, 1];
        const stateDict = JSON.parse(state.get_state());
        const params = JSON.parse(state.get_parameters());

        const p = vec3.fromValues(...stateDict['position']);
        const q = quat.fromValues(
            stateDict['orientation'][1],
            stateDict['orientation'][2],
            stateDict['orientation'][3],
            stateDict['orientation'][0]
        );
        const v = vec3.fromValues(...stateDict['linear_velocity']);
        const omega = vec3.fromValues(...stateDict['angular_velocity']);

        const m = params['dynamics']['mass'];
        const g = -params['dynamics']['gravity'][2];
        const l = 0.028;
        const k_q = params['dynamics']['rotor_torque_constants'][0];
        const [a, b, c] = params['dynamics']['rotor_thrust_coefficients'][0];

        const k_p = 3.0;
        const k_d = 2.0;
        const k_R = 1.0;
        const k_omega = 0.1;

        const p_des = vec3.fromValues(0, 0, 0);
        const v_des = vec3.fromValues(0, 0, 0);

        const e_p = vec3.create();
        vec3.subtract(e_p, p, p_des);
        const e_v = vec3.create();
        vec3.subtract(e_v, v, v_des);

        const a_des = vec3.create();
        vec3.scale(a_des, e_p, -k_p);
        const temp = vec3.create();
        vec3.scale(temp, e_v, -k_d);
        vec3.add(a_des, a_des, temp);

        const T = m * (a_des[2] + g);

        const q_des_conj = quat.create();
        quat.conjugate(q_des_conj, q_des);
        const q_err = quat.create();
        quat.multiply(q_err, q_des_conj, q);

        if (q_err[3] < 0){
            quat.scale(q_err, q_err, -1);
        }

        const e_R = vec3.fromValues(q_err[0], q_err[1], q_err[2]);
        vec3.scale(e_R, e_R, 2);

        const tau = vec3.create();
        vec3.scale(tau, e_R, -k_R);
        const temp2 = vec3.create();
        vec3.scale(temp2, omega, -k_omega);
        vec3.add(tau, tau, temp2);

        const A_inv = mat4.fromValues(
            1/4, -1/(4*l), -1/(4*l), -1/(4*k_q),
            1/4, -1/(4*l),  1/(4*l),  1/(4*k_q),
            1/4,  1/(4*l),  1/(4*l), -1/(4*k_q),
            1/4,  1/(4*l), -1/(4*l),  1/(4*k_q)
        );
        const controlInputs = vec4.fromValues(T, tau[0], tau[1], tau[2]);
        const f = vec4.create();
        vec4.transformMat4(f, controlInputs, A_inv);

        const f_clipped = [
            Math.max(0, f[0]),
            Math.max(0, f[1]),
            Math.max(0, f[2]),
            Math.max(0, f[3])
        ];

        function solveRPM(fi) {
            const discriminant = b * b - 4 * a * (c - fi);
            if (discriminant < 0 || fi < c) {
                return 0.0;
            }
            const rpm = (-b + Math.sqrt(discriminant)) / (2 * a);
            return Math.max(0.0, Math.min(1.0, rpm));
        }

        const action = f_clipped.map(solveRPM);

        return action;
    }
    reset() {
    }
}

