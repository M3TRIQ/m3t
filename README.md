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
m3t md results <job-id>
```

## Structure Prediction

```bash
m3t predict esmfold MKFLILLFNILCL...       # Fast (~10s, max 1024aa)
m3t predict alphafold2 MKFLILLFNILCL...     # Accurate (~5min, max 2048aa)
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
