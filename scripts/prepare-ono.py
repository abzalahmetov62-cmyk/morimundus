"""Prepare one voice grain from each supplied Ono recording without altering originals."""
import argparse, hashlib, json, pathlib, subprocess, wave
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('source_directory', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('public/voices/ono'))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
rate = 32000
records = []
for index in range(1, 5):
    source = args.source_directory / f'оно{index}.m4a'
    decoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source), '-ac', '1', '-ar', str(rate), '-f', 'f32le', '-'])
    samples = np.frombuffer(decoded, dtype='<f4').copy()
    size = round(.20 * rate)
    if len(samples) < size or not np.isfinite(samples).all():
        raise ValueError('Invalid recording: ' + source.name)
    starts = range(0, len(samples) - size + 1, rate // 100)
    start = max(starts, key=lambda pos: float(np.mean(samples[pos:pos + size] ** 2)))
    grain = samples[start:start + size].copy()
    grain -= grain.mean()
    rms, peak = float(np.sqrt(np.mean(grain ** 2))), float(abs(grain).max())
    if rms < .0001:
        raise ValueError('Silent recording: ' + source.name)
    grain *= min(.11 / rms, .65 / peak)
    fade = round(.005 * rate)
    grain[:fade] *= np.linspace(0, 1, fade)
    grain[-fade:] *= np.linspace(1, 0, fade)
    filename = f'{index:02}.wav'
    with wave.open(str(args.output / filename), 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate)
        output.writeframes((np.clip(grain, -1, 1) * 32767).astype('<i2').tobytes())
    records.append({'file': filename, 'source': source.name, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'startSeconds': round(start / rate, 5), 'duration': len(grain) / rate, 'peak': round(float(abs(grain).max()), 4)})
(args.output / 'sources.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'samples': len(records), 'bytes': sum(p.stat().st_size for p in args.output.glob('*.wav'))}))
