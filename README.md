```
./download_dependencies.sh
```
```
./build_emscripten.sh
```

```
cp ../rltools.js/main.js blob/lib/rltools.js
```

```
```

```
npm install three@0.156.0 mathjs@14.3.1 stats.js@0.17.0 jsfive@0.4.0 gl-matrix@3.4.3
npm uninstall rltools; npm install rltools@file:../rltools.js/
npm install --save-dev esbuild
./bundle.sh
```