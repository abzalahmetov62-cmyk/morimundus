export function gameCyclePulse(): Uint8Array<ArrayBuffer> {
  const rate = 16000, samples = rate, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    let pulse = 0;
    for (const [start, volume] of [[0.08, .65], [.29, .4]]) {
      const age = time - start;
      if (age >= 0 && age < .18) pulse += Math.sin(age * Math.PI * 2 * 58) * Math.sin(Math.min(1, age / .012) * Math.PI / 2) * Math.exp(-age * 32) * volume;
    }
    view.setInt16(44 + index * 2, Math.round(pulse * 32767), true);
  }
  return bytes;
}
