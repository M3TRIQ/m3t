# m3t

The M3TRIQ CLI — protein-ligand analysis from the terminal.

Query self-hosted databases (ChEMBL, FooDB, ZINC), predict ADMET properties, run molecular docking, and submit molecular dynamics simulations — all from the command line.

## Install

```bash
npm install -g m3triq
```

## Setup

```bash
m3t config --key <your-api-key>
m3t projects                  # list your projects
m3t use <project-id>          # set active project
```

## Databases

### ChEMBL (2.4M compounds, self-hosted)

```bash
m3t chembl search aspirin
m3t chembl info CHEMBL25
m3t chembl targets PDE3B
m3t chembl binders EGFR --max-value 1000 --save "EGFR Binders"
m3t chembl activities CHEMBL25 --type IC50
m3t chembl similar "CC(=O)Oc1ccccc1C(=O)O" --threshold 0.7
m3t chembl sql "SELECT chembl_id, pref_name FROM molecule_dictionary WHERE pref_name ILIKE '%caffeine%'"
```

### FooDB (food compounds, self-hosted)

```bash
m3t foodb search tomato --limit 20
m3t foodb info caffeine
m3t foodb export banana --name "Banana Compounds"
m3t foodb random --count 50 --group Fruits
```

### ZINC (14M purchasable compounds, self-hosted)

```bash
m3t zinc search --subset drug-like --mw-min 200 --mw-max 500
m3t zinc info ZINC000000000001
m3t zinc random --count 20 --subset lead-like
```

## ADMET Prediction (41 properties)

Self-hosted ADMET-AI model. Predicts absorption, distribution, metabolism, excretion, and toxicity.

```bash
m3t admet predict "CC(=O)Oc1ccccc1C(=O)O"
m3t admet batch "CCO" "CC(=O)Oc1ccccc1C(=O)O" "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
m3t admet compare "CCO" "CCCO" --name1 Ethanol --name2 Propanol
```

## Molecular Docking

```bash
# Single compound
m3t dock gnina "CCO" 5NJ8 --cx 10 --cy 20 --cz 30
m3t dock vina "CCO" 5NJ8 --cx 10 --cy 20 --cz 30
m3t dock diffdock "CCO" 5NJ8

# Batch (CSV with smiles column)
m3t batch gnina compounds.csv 5NJ8 --cx 10 --cy 20 --cz 30
```

## Molecular Dynamics

GPU-accelerated simulations to validate docking poses.

```bash
m3t md run --protein 5NJ8 --ligand-smiles "CCO" --mode quick
m3t md run --diffdock-job <job-id> --mode standard
m3t md run --protein <oriented.pdb> --membrane            # cell-membrane MD (POPC bilayer, CHARMM36)
m3t md run --protein 5NJ8 --ligand-smiles "CCO" --gpu h100 # run on an H100 (80GB VRAM)
m3t md run --protein 5NJ8 --ligand-smiles "CCO" --gpu h200 # …or an H200 (141GB, ~1.4× bandwidth)
m3t md results <job-id>
```

`--membrane` runs cell-membrane MD for membrane proteins (GPCRs, transporters, ion channels): the protein is embedded in a POPC lipid bilayer with CHARMM36 instead of a plain water box. The input **must be a membrane-oriented structure** (transmembrane axis along Z, e.g. from the [OPM database](https://opm.phar.umich.edu)) — the worker does not orient the protein for you, so a raw RCSB structure produces a misaligned bilayer.

`--gpu` selects the GPU backend: `a100` (default, GCP A100-40GB), `h100` (Nebius H100-80GB) or `h200` (Nebius H200-141GB) — both Nebius GPUs live in eu-north1. For typical soluble protein-ligand MD the A100 is the cost-effective default; reach for a Nebius GPU when the system is large enough to need the big VRAM (membrane bilayers, large multi-chain complexes) or when you want lower wall-clock latency. `h200` has ~1.4× the memory bandwidth of `h100` (and MD is bandwidth-bound), so it's usually a bit faster for a modestly higher rate. Nebius runs are billed at the matching GPU rate.

## Structure Prediction

```bash
m3t predict esmfold MKFLILLFNILCL...        # Fast (~10s, max 1024aa)
m3t predict alphafold2 MKFLILLFNILCL...     # AF2-ptm monomer via deep MSA + ColabFold (~5-15min)

# ESMFold2-Fast — monomer or multi-chain complex (self-hosted A100, max 2048aa total).
# Beats AlphaFold3 on antibody-antigen DockQ from single sequence; returns pLDDT/pTM/ipTM.
m3t predict esmfold2 --sequence MKFLILLFNILCL...              # monomer
m3t predict esmfold2 --chain A:EVQL... --chain B:DIQM...      # complex (antibody-antigen, PPI)
m3t predict esmfold2-batch inputs.json                        # fold N complexes (results in input order)

# AF2-Multimer — fold a protein complex (homo-/hetero-oligomer) with deep MSA + PDB templates
m3t predict af2multimer --protein MKFL... --copies 3          # homotrimer (the biological unit)
m3t predict af2multimer --protein EVQL... --protein DIQM...   # hetero-complex (distinct chains)
m3t predict af2multimer --protein A... --protein B... --copies 2,1   # 2×A + 1×B

# Boltz-2 — biomolecular complex (protein + DNA/RNA + ligand) with binding affinity
m3t predict boltz2 --protein MKFL... --ligand "CC(=O)O" --rna GGUC...
m3t predict boltz2 --protein MKFL... --ligand "CC(=O)O" --depth exhaustive   # + real per-chain MSAs

# OpenFold3 — AlphaFold3-class complex (protein + DNA/RNA + ligand); real MSAs
m3t predict openfold3 --protein EVQL... --protein DIQM...      # complex, auto-paired
m3t predict openfold3 --protein MKFL... --ligand ATP --depth exhaustive
```

## Carbohydrate / Glycan Co-folding

Protein–carbohydrate interactions (e.g. lectins, phage receptor-binding proteins,
glycan-recognizing binders) are poorly served by classical docking — Vina/GNINA
score sugars badly. The reliable route is to **define** the glycan, then **co-fold**
it with the protein in an AlphaFold3-class model.

```bash
# Define a glycan: IUPAC-condensed → SMILES + 3D SDF + per-residue CCD/bond decomposition
m3t glycan build "Gal(b1-4)GlcNAc"
m3t glycan build "Neu5Ac(a2-3)Gal(b1-4)Glc" --out sialyllactose.sdf --attach N-linked

# Co-fold a protein with a glycan
m3t predict openfold3 --protein MKFL... \
  --glycan "Man(a1-3)[Man(a1-6)]Man(b1-4)GlcNAc(b1-4)GlcNAc" --depth exhaustive   # one connected SMILES ligand (default)
m3t predict openfold3 --protein MKFL... --glycan "Gal(b1-4)GlcNAc" --glycan-ccd   # experimental CCD + bondedAtomPairs (see caveat)
m3t predict boltz2    --protein MKFL... --glycan "Gal(b1-4)GlcNAc" --depth exhaustive
```

- **IUPAC-condensed**: reducing end on the **right**, linkages in `()`, branches in `[]`
  (e.g. `Neu5Ac(a2-3)Gal(b1-4)Glc`). Common monosaccharides map to PDB CCD codes.
- `--glycan` defaults to **one connected SMILES ligand**. The AF3-glycan literature
  recommends per-residue CCD + `bondedAtomPairs` — but that assumes the model honors the
  bonds, and the **hosted OpenFold3 NIM does not** (verified: a 2-sugar CCD glycan comes out
  with the sugars ~4 Å apart, disconnected). SMILES is one bonded molecule, so it stays
  connected. `--glycan-ccd` opts into the CCD path for AF3-proper backends — validate the
  result with the geometry checker.
- `--glycan` on **Boltz-2** rides as a single SMILES ligand (Boltz-2 has no inter-entity
  bond field).
- **pLDDT is unreliable for carbohydrates** — high confidence can accompany wrong
  stereochemistry. Validate ring pucker / glycosidic torsions on the output.
- `--depth exhaustive` (metagenomic envDB) is recommended for orphan / phage / bacterial
  families where standard databases come back sparse.

## MSA Generation

Generate a multiple-sequence alignment (`.a3m`) — the evolutionary input folders use.
Two orthogonal knobs: **`--depth`** = coverage (databases), **`--pair`** = species
pairing (only matters for multi-chain complexes; on by default, a monomer is never paired).

```bash
m3t msa --sequence MKFL...                                   # standard, monomer
m3t msa --chain A:EVQL... --chain B:DIQM...                  # standard complex, auto-paired
m3t msa --chain A:EVQL... --chain B:DIQM... --no-pair        # complex, force unpaired
m3t msa --sequence MKFL... --depth exhaustive --templates    # + metagenomic envDB + PDB templates
m3t msa --sequence MKFL... --depth custom \
        --databases uniref30,envdb --max-sequences 300       # fine control (max_sequences caps depth)
```

- `--depth`: `standard` (UniRef30, default) | `exhaustive` (+ metagenomic envDB) | `custom`
- `--templates`: also save per-chain PDB structural templates (`templates_<chain>.json`)
- Output: one `.a3m` per chain in the project's Files tab; repeat sequences are cached (instant)

## Protein Embeddings

```bash
# ESMC-6B per-residue embeddings + pseudo-perplexity (lower = more "natural" sequence)
m3t embed esmc --sequence MKFLILLFNILCL...           # single sequence
m3t embed esmc --sequence SEQ1 --sequence SEQ2       # batch (repeatable, max 32)
```

## Protein Design

```bash
m3t design rfantibody 6VXX --hotspots A100,A105 --type nanobody --designs 3
```

## Other Commands

```bash
m3t jobs                          # list recent jobs
m3t job <id>                      # job status & results
m3t data                          # list project datasets
m3t dataset <id> --limit 20      # view dataset rows
m3t run script.py --packages pandas,httpx --save "Results"
```

## JSON Mode

Pipe-friendly output for scripting:

```bash
m3t --json chembl binders PDE3B | jq '.[].canonical_smiles'
m3t --json zinc search --subset drug-like | jq length
```

## Project-per-folder

Like `.git`, each directory can be tied to a different M3TRIQ project:

```bash
cd ~/research/egfr && m3t use <project-id>    # writes .m3triq here
cd ~/research/pde3b && m3t use <project-id>   # different project
m3t use --global <id>                          # fallback
```

## Links

- [M3TRIQ Platform](https://console.m3triq.com)
- [Documentation](https://m3triq.com)
