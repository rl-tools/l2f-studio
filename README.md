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
npm install three@0.156.0 mathjs@14.3.1 stats.js@0.17.0 jsfive@0.4.0
npm install esbuild --save-dev 
npx esbuild dependencies/dependencies.js --bundle --minify --format=esm --outfile=lib/dependencies.js
npx esbuild dependencies/jsfive.js --bundle --minify --format=esm --outfile=lib/jsfive.js
npx esbuild dependencies/three.js --bundle --minify --format=esm --outfile=lib/three.js
npx esbuild dependencies/math.js --bundle --minify --format=esm --outfile=lib/math.js
```