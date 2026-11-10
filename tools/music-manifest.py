#!/usr/bin/env python3
"""
Measure every bundled music file and write music/manifest.json:

    { "menu/my-street.ogg": { "kbps": 160, "channels": 2, "rate": 44100,
                              "duration": 212.97, "bytes": 3868262,
                              "lufs": -14.2, "peak": -0.3, "gain": 0.62 }, ... }

`gain` brings every track to the same loudness (EBU R128, TARGET_LUFS) without
pushing its true peak over -1 dBTP, so the TV can set the right level *before*
a track starts (no jump when songs change). `kbps` is the encoder's nominal
bitrate; the unit tests enforce a quality floor on it.

Needs ffmpeg/ffprobe on the machine that runs it (not at play time):
    python3 tools/music-manifest.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
MUSIC = ROOT / 'music'
OUT = MUSIC / 'manifest.json'
AUDIO = {'.mp3', '.ogg', '.m4a', '.wav', '.opus'}
TARGET_LUFS = -18.0
MAX_PEAK_DB = -1.0


def probe(f: Path) -> dict[str, Any]:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
         'stream=bit_rate,channels,sample_rate:format=duration,bit_rate', '-of', 'json', str(f)],
        check=True, capture_output=True, text=True).stdout
    d: dict[str, Any] = json.loads(out)
    s = d['streams'][0]
    fmt = d['format']
    kbps = int(s.get('bit_rate') or fmt.get('bit_rate') or 0) // 1000
    return {'kbps': kbps, 'channels': int(s['channels']), 'rate': int(s['sample_rate']),
            'duration': round(float(fmt['duration']), 2)}


def loudness(f: Path) -> tuple[float, float]:
    err = subprocess.run(
        ['ffmpeg', '-hide_banner', '-nostats', '-i', str(f), '-af',
         f'loudnorm=I={TARGET_LUFS}:TP={MAX_PEAK_DB}:print_format=json', '-f', 'null', '-'],
        check=True, capture_output=True, text=True).stderr
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', err)
    if not m:
        raise RuntimeError(f'no loudness for {f}')
    j: dict[str, str] = json.loads(m.group(0))
    return float(j['input_i']), float(j['input_tp'])


def main() -> None:
    old: dict[str, dict[str, Any]] = json.loads(OUT.read_text()) if OUT.exists() else {}
    out: dict[str, dict[str, Any]] = {}
    for f in sorted(MUSIC.rglob('*')):
        if f.suffix.lower() not in AUDIO:
            continue
        rel = f.relative_to(MUSIC).as_posix()
        size = f.stat().st_size
        if rel in old and old[rel].get('bytes') == size:
            out[rel] = old[rel]
            continue
        info = probe(f)
        lufs, peak = loudness(f)
        gain = 10 ** ((TARGET_LUFS - lufs) / 20)
        gain = min(gain, 10 ** ((MAX_PEAK_DB - peak) / 20), 4.0)
        info.update({'bytes': size, 'lufs': lufs, 'peak': peak, 'gain': round(max(0.25, gain), 3)})
        out[rel] = info
        print(f'{rel:60s} {info["kbps"]:4d} kbps  {lufs:6.1f} LUFS  gain {info["gain"]}', file=sys.stderr)
    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(out)} tracks)', file=sys.stderr)


if __name__ == '__main__':
    main()
