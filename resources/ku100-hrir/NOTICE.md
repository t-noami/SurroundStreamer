# Neumann KU100 Near-Field HRIR Notice

SurroundStreamer includes a reduced HRIR extraction derived from:

Spherical Near-Field (NF) HRIR Compilation of the Neumann KU100

Authors:

- Johannes M. Arend
- Annika Neidhardt
- Christoph Pörschmann

Source:

https://zenodo.org/records/4297951

DOI:

10.5281/zenodo.4297951

License:

Creative Commons Attribution 4.0 International

https://creativecommons.org/licenses/by/4.0/

Changes made for SurroundStreamer:

- Extracted the subset of HRIR directions used by the application's monitor and MP3 HRIR modes.
- Converted the selected impulse responses into small stereo WAV assets for FFmpeg `headphone`
  filter use in packaged builds.
- Added silent placeholder WAV assets for channel labels that do not have a direct HRIR response.
