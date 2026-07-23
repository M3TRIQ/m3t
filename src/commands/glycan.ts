import fs from 'node:fs';
import type { Command } from 'commander';
import { createAgentsClient } from '../cli.js';
import { output } from '../output.js';
import type { GlycanBuildResult } from '../types.js';

export function registerGlycanCommands(program: Command): void {
  const glycan = program
    .command('glycan')
    .description('Build / define carbohydrate (glycan) ligands for co-folding and docking');

  // m3t glycan build "<iupac>"
  glycan
    .command('build')
    .argument('<iupac>', 'Glycan in IUPAC-condensed notation (reducing end on the right). e.g. "Gal(b1-4)GlcNAc"')
    .description('Build a glycan from IUPAC-condensed notation → SMILES + 3D SDF + CCD/bond decomposition')
    .option('--out <file.sdf>', 'Write the 3D structure to an SDF file')
    .option('--no-3d', 'Skip 3D conformer generation (SMILES + decomposition only)')
    .option('--attach <type>', 'Also emit a protein-glycosylation attachment template: N-linked | O-linked | O-linked-thr')
    .action(async (iupac: string, opts) => {
      await runGlycanBuild(iupac, opts);
    });
}

interface GlycanBuildOpts {
  out?: string;
  '3d'?: boolean;
  attach?: string;
}

export async function buildGlycanViaMcp(iupac: string, embed3d = true, attachment?: string): Promise<GlycanBuildResult> {
  const agents = createAgentsClient();
  const data = (await agents.callMcpTool('rdkit', 'build_glycan', {
    iupac,
    embed_3d: embed3d,
    ...(attachment ? { attachment } : {}),
  })) as unknown as GlycanBuildResult;
  if (data.success === false || data.error) {
    throw new Error(data.error ?? `could not build glycan "${iupac}"`);
  }
  return data;
}

async function runGlycanBuild(iupac: string, opts: GlycanBuildOpts): Promise<void> {
  const embed3d = opts['3d'] !== false || !!opts.out; // need 3D if writing SDF
  let result: GlycanBuildResult;
  try {
    result = await buildGlycanViaMcp(iupac, embed3d, opts.attach);
  } catch (e: any) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
    return;
  }

  if (opts.out) {
    if (!result.sdf) {
      process.stderr.write('Warning: no 3D structure was generated; nothing written.\n');
    } else {
      fs.writeFileSync(opts.out, result.sdf);
      process.stderr.write(`Wrote 3D structure → ${opts.out}\n`);
    }
  }

  const lines = [
    `Glycan: ${iupac}`,
    `SMILES: ${result.smiles}`,
    `Formula: ${result.formula ?? '?'}   MW: ${result.molecular_weight ?? '?'}   rotatable bonds: ${result.n_rotatable_bonds ?? '?'}`,
  ];
  if (result.ccd_supported && result.residues) {
    lines.push(`Residues (${result.n_residues}, reducing-end first): ${result.residues.map(r => `${r.name}[${r.ccd}]`).join(' · ')}`);
    if (result.bonds && result.bonds.length > 0) {
      lines.push(`Glycosidic bonds: ${result.bonds.map(b => `${b.child_idx}.${b.child_atom}→${b.parent_idx}.${b.parent_atom} (${b.linkage})`).join(', ')}`);
    }
    lines.push('Use with: m3t predict openfold3 --protein <seq> --glycan "' + iupac + '" --depth exhaustive   (co-folds as one connected SMILES ligand)');
  } else if (result.ccd_note) {
    lines.push(`Note: ${result.ccd_note}`);
    lines.push('Use with: m3t predict openfold3 --protein <seq> --glycan "' + iupac + '" --depth exhaustive   (SMILES ligand)');
  }
  if (result.attachment) {
    const a = result.attachment as Record<string, unknown>;
    lines.push(`Attachment: glycan ${a.glycan_atom} → protein ${a.protein_residue} ${a.protein_atom} (${a.type})`);
  }

  output(result, lines.join('\n'));
}
