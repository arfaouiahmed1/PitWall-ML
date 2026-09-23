# Circuit geometry attribution

Bundled circuit geometry is converted from GeoJSON files in
[`bacinger/f1-circuits`](https://github.com/bacinger/f1-circuits), revision
`394d8fbe70ef2c0b0c8d23ff7bee61fa09606055`. Each geometry records its exact
source file, source-file SHA-256, and original longitude/latitude coordinates.
The checked-in converter documents the local equirectangular projection and
normalization applied to those coordinates. The browser uses the generated
TypeScript bundles only; it makes no request for circuit data at runtime.

The upstream project describes itself as unofficial and not approved or
endorsed by Formula One Licensing B.V. These geometries are not FIA/F1-official
and do not encode turn locations, sector splits, DRS zones, or speed traps.
Those overlays are marked unavailable in the registry.

## Upstream MIT license

Copyright (c) 2019-2025 Tomislav Bacinger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
