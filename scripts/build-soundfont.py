"""Builds the soundfont TaBello plays scores with, from GeneralUser GS by S. Christian Collins.

It keeps only what TaBello plays (steel and nylon guitar, finger bass, and the metronome click of the
drum kit) and raises each one to the same loudness as the others: alphaTab applies a soundfont's
attenuation in full, which leaves GeneralUser's guitars about 15 dB quieter than its bass. Sample data
is copied unchanged.

    python3 scripts/build-soundfont.py GeneralUser-GS.sf2 src/renderer/public/soundfont/generaluser-gs-tabello.sf2

GeneralUser GS v2.0.3: https://github.com/mrbumpy409/GeneralUser-GS (see its LICENSE.txt).
"""
import struct
import sys

# (bank, program): gain in dB. Bank 0 holds the General MIDI instruments of shared/instruments.ts,
# bank 128 the drum kit, whose key 33 is alphaTab's metronome click (34 its accented click).
PRESETS = {(0, 25): 15.7, (0, 33): 4.5, (0, 24): 8.7, (128, 0): 10.0}
DRUM_KEYS = {33, 34}

GEN_KEY_RANGE, GEN_ATTENUATION, GEN_INSTRUMENT, GEN_SAMPLE = 43, 48, 41, 53
LINKED_SAMPLE_TYPES = (2, 4, 8)
RECORDS = {
    b'phdr': ('<20sHHHIII', 38), b'pbag': ('<HH', 4), b'pmod': ('<HHhHH', 10), b'pgen': ('<HH', 4),
    b'inst': ('<20sH', 22), b'ibag': ('<HH', 4), b'imod': ('<HHhHH', 10), b'igen': ('<HH', 4),
    b'shdr': ('<20sIIIIIBbHH', 46),
}


def chunks(data, offset, end):
    while offset < end:
        size = struct.unpack('<I', data[offset + 4:offset + 8])[0]
        yield data[offset:offset + 4], offset + 8, size
        offset += 8 + size + (size & 1)


def read(path):
    data = open(path, 'rb').read()
    if data[:4] != b'RIFF' or data[8:12] != b'sfbk':
        sys.exit(f'{path} is not a SoundFont 2 file')
    parts = {}
    for _, offset, size in chunks(data, 12, len(data)):
        kind = data[offset:offset + 4]
        for sub, sub_offset, sub_size in chunks(data, offset + 4, offset + size):
            parts[(kind, sub)] = data[sub_offset:sub_offset + sub_size]
    hydra = {}
    for name, (fmt, size) in RECORDS.items():
        raw = parts[(b'pdta', name)]
        hydra[name] = [list(struct.unpack(fmt, raw[i:i + size])) for i in range(0, len(raw), size)]
    return parts, hydra


def signed(value):
    return value - 0x10000 if value >= 0x8000 else value


def build(source, target):
    parts, h = read(source)
    phdr, inst, shdr = h[b'phdr'], h[b'inst'], h[b'shdr']

    def zones(head, bags, gens, index, bag_field):
        """The generator lists of a preset's or instrument's zones, by bag index."""
        for bag in range(head[index][bag_field], head[index + 1][bag_field]):
            yield bag, [tuple(gens[g]) for g in range(bags[bag][0], bags[bag + 1][0])]

    presets = [i for i in range(len(phdr) - 1) if (phdr[i][2], phdr[i][1]) in PRESETS]
    drum_insts = set()
    instruments = []
    for p in presets:
        for _, gens in zones(phdr, h[b'pbag'], h[b'pgen'], p, 3):
            for oper, amount in gens:
                if oper == GEN_INSTRUMENT:
                    if amount not in instruments:
                        instruments.append(amount)
                    if phdr[p][2] == 128:
                        drum_insts.add(amount)
    instruments.sort()

    def keep_inst_zone(i, gens):
        """Drum zones only for the metronome's keys (the global zone, without a sample, always)."""
        values = dict(gens)
        if i not in drum_insts or GEN_SAMPLE not in values:
            return True
        key_range = values.get(GEN_KEY_RANGE, 0x7F00)
        return any((key_range & 0xFF) <= key <= (key_range >> 8) for key in DRUM_KEYS)

    samples = set()
    for i in instruments:
        for _, gens in zones(inst, h[b'ibag'], h[b'igen'], i, 1):
            if keep_inst_zone(i, gens):
                samples.update(amount for oper, amount in gens if oper == GEN_SAMPLE)
    for s in list(samples):
        if shdr[s][9] in LINKED_SAMPLE_TYPES and shdr[s][8] < len(shdr) - 1:
            samples.add(shdr[s][8])  # the other channel of a stereo sample
    samples = sorted(samples)
    inst_index = {old: new for new, old in enumerate(instruments)}
    sample_index = {old: new for new, old in enumerate(samples)}

    def louder(p, gens, global_attenuation):
        """Raises a preset by its gain. Preset attenuation is an offset: alphaTab adds a global
        zone's value to each zone's, the SF2 spec lets a zone's own value replace it, so the gain
        goes into whichever values are set (none of these presets sets both)."""
        gain = round(PRESETS[(phdr[p][2], phdr[p][1])] * 10)
        values = dict(gens)
        if GEN_ATTENUATION in values:
            attenuation = signed(values[GEN_ATTENUATION]) - gain
        elif GEN_INSTRUMENT in values and not global_attenuation:
            attenuation = -gain
        else:
            return gens
        rest = [(o, a) for o, a in gens if o not in (GEN_ATTENUATION, GEN_INSTRUMENT)]
        # The instrument generator must stay last in its zone.
        return rest + [(GEN_ATTENUATION, attenuation)] + [(o, a) for o, a in gens if o == GEN_INSTRUMENT]

    smpl_in = parts[(b'sdta', b'smpl')]
    smpl = bytearray()
    new_shdr = []
    for s in samples:
        name, start, end, loop_start, loop_end, rate, key, correction, link, kind = shdr[s]
        base = len(smpl) // 2
        # Each sample is followed by 46 zero data points, as the spec requires.
        smpl += smpl_in[start * 2:end * 2] + b'\0' * 92
        if kind in LINKED_SAMPLE_TYPES and link not in sample_index:
            kind, link = 1, 0
        new_shdr.append([name, base, base + end - start, base + loop_start - start, base + loop_end - start,
                         rate, key, correction, sample_index.get(link, 0), kind])
    new_shdr.append([b'EOS', 0, 0, 0, 0, 0, 0, 0, 0, 0])

    ibag, igen, imod, new_inst = [], [], [], []
    for i in instruments:
        new_inst.append([inst[i][0], len(ibag)])
        for bag, gens in zones(inst, h[b'ibag'], h[b'igen'], i, 1):
            if not keep_inst_zone(i, gens):
                continue
            ibag.append([len(igen), len(imod)])
            igen += [[o, sample_index[a] if o == GEN_SAMPLE else a] for o, a in gens]
            imod += h[b'imod'][h[b'ibag'][bag][1]:h[b'ibag'][bag + 1][1]]
    new_inst.append([b'EOI', len(ibag)])
    ibag.append([len(igen), len(imod)])
    igen.append([0, 0])
    imod.append([0, 0, 0, 0, 0])

    pbag, pgen, pmod, new_phdr = [], [], [], []
    for p in presets:
        new_phdr.append([phdr[p][0], phdr[p][1], phdr[p][2], len(pbag), phdr[p][4], phdr[p][5], phdr[p][6]])
        preset_zones = list(zones(phdr, h[b'pbag'], h[b'pgen'], p, 3))
        first = dict(preset_zones[0][1])
        global_attenuation = GEN_INSTRUMENT not in first and GEN_ATTENUATION in first
        for bag, gens in preset_zones:
            pbag.append([len(pgen), len(pmod)])
            pgen += [[o, (inst_index[a] if o == GEN_INSTRUMENT else a) & 0xFFFF] for o, a in louder(p, gens, global_attenuation)]
            pmod += h[b'pmod'][h[b'pbag'][bag][1]:h[b'pbag'][bag + 1][1]]
    new_phdr.append([b'EOP', 0, 0, len(pbag), 0, 0, 0])
    pbag.append([len(pgen), len(pmod)])
    pgen.append([0, 0])
    pmod.append([0, 0, 0, 0, 0])

    def chunk(cid, body):
        return cid + struct.pack('<I', len(body)) + body + (b'\0' if len(body) & 1 else b'')

    def pack(name, rows):
        return b''.join(struct.pack(RECORDS[name][0], *row) for row in rows)

    info = b''.join(chunk(sub, body) for (kind, sub), body in parts.items() if kind == b'INFO' and sub != b'ICMT')
    info += chunk(b'ICMT', b'GeneralUser GS v2.0.3 by S. Christian Collins, reduced and rebalanced for TaBello '
                           b'(scripts/build-soundfont.py).\0')
    pdta = b''.join(chunk(name, pack(name, rows)) for name, rows in [
        (b'phdr', new_phdr), (b'pbag', pbag), (b'pmod', pmod), (b'pgen', pgen),
        (b'inst', new_inst), (b'ibag', ibag), (b'imod', imod), (b'igen', igen), (b'shdr', new_shdr)])
    body = (b'sfbk' + chunk(b'LIST', b'INFO' + info) + chunk(b'LIST', b'sdta' + chunk(b'smpl', bytes(smpl)))
            + chunk(b'LIST', b'pdta' + pdta))
    open(target, 'wb').write(b'RIFF' + struct.pack('<I', len(body)) + body)
    names = ', '.join(row[0].split(b'\0')[0].decode('latin-1') for row in new_phdr[:-1])
    print(f'{target}: {names}; {len(samples)} samples, {(len(body) + 8) / 1e6:.2f} MB')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2])
