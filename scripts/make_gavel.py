"""Writes the gavel clip: two short wooden knocks, synthesized, 16-bit mono WAV."""

import math
import random
import struct
import sys
import wave

RATE = 22050


def knock(length_s: float, pitch_hz: float) -> list[float]:
    rng = random.Random(7)
    samples = []
    for i in range(int(RATE * length_s)):
        t = i / RATE
        envelope = math.exp(-t * 38)
        body = math.sin(2 * math.pi * pitch_hz * t) + 0.5 * math.sin(2 * math.pi * pitch_hz * 2.7 * t)
        click = rng.uniform(-1, 1) * math.exp(-t * 400)
        samples.append(envelope * (0.6 * body + 0.8 * click))
    return samples


def main(path: str) -> None:
    gap = [0.0] * int(RATE * 0.12)
    clip = knock(0.18, 180) + gap + knock(0.25, 165)
    peak = max(abs(s) for s in clip)
    frames = b"".join(struct.pack("<h", int(32000 * s / peak)) for s in clip)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames)


if __name__ == "__main__":
    main(sys.argv[1])
