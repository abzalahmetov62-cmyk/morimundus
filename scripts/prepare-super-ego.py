"""Prepare the supplied recordings as small, reusable voice grains; originals stay untouched."""
import argparse, hashlib, json, pathlib, subprocess, wave
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('source_directory', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('public/voices/super-ego'))
args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
records = []; rate = 32000; index = 0
for name, count, seconds in [('супер-эго-короткий1.m4a',1,.15),('супер-эго-короткий2.m4a',1,.16),('супер-эго-длинный1.mp3',2,.20),('супер-эго-длинный2.m4a',2,.18),('супер-эго-длинный3.m4a',2,.19)]:
    source = args.source_directory / name
    decoded = subprocess.check_output(['ffmpeg','-v','error','-i',str(source),'-ac','1','-ar',str(rate),'-f','f32le','-'])
    samples = np.frombuffer(decoded,dtype='<f4').copy()
    step = rate//100; envelope = np.array([np.sqrt(np.mean(samples[i:i+step]**2)) for i in range(0,len(samples)-step,step)])
    active = np.flatnonzero(envelope > max(.004,float(envelope.max())*.035))
    if not len(active): raise ValueError('Silent recording: '+name)
    first, last = int(active[0]*step), min(len(samples),int((active[-1]+1)*step))
    for section in range(count):
        size = round(seconds*rate); low = first+(last-first)*section//count; high = first+(last-first)*(section+1)//count
        starts = range(max(0,low),max(low+1,high-size+1),step)
        start = max(starts,key=lambda pos:float(np.mean(samples[pos:pos+size]**2)))
        grain = samples[start:start+size].copy(); grain -= grain.mean()
        gain = min(.11/max(float(np.sqrt(np.mean(grain**2))),1e-6), .65/max(float(abs(grain).max()),1e-6))
        grain *= gain; fade = min(len(grain)//2,round(.005*rate)); grain[:fade] *= np.linspace(0,1,fade); grain[-fade:] *= np.linspace(1,0,fade)
        pcm = (np.clip(grain,-1,1)*32767).astype('<i2'); index+=1; filename=f'{index:02}.wav'
        with wave.open(str(args.output/filename),'wb') as output: output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate); output.writeframes(pcm.tobytes())
        records.append({'file':filename,'source':name,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'startSeconds':round(start/rate,5),'duration':len(grain)/rate,'peak':round(float(abs(grain).max()),4)})
(args.output/'sources.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'samples':len(records),'bytes':sum(p.stat().st_size for p in args.output.glob('*.wav'))}))
