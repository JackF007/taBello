import * as alphaTab from '@coderline/alphatab';

/** Converts an alphaTex score to a Guitar Pro 7 (.gp) file, readable by Guitar Pro, MuseScore, TuxGuitar… */
export function toGuitarPro(alphaTex: string): Uint8Array {
  const settings = new alphaTab.Settings();
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(alphaTex, settings);
  const score = importer.readScore();
  return new alphaTab.exporter.Gp7Exporter().export(score, settings);
}
