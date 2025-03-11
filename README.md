```
./download_dependencies.sh
```
```
./build_emscripten.sh
```

```
cp ../RLtools.js/rl_tools.js blob/rl_tools.js
```

```
```

```
npm install three@0.156.0 mathjs@14.3.1 stats.js@0.17.0 jsfive@0.4.0 
npm uninstall rltools; npm install rltools@file:../rltools.js/
npm install --save-dev esbuild
./bundle.sh
```