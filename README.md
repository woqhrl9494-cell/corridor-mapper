# EchoMap — Corridor Mapper

> **Interactive bistatic radar tomography simulator** for real-time corridor wall estimation using ellipse accumulation, density scoring, and coherence analysis.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=for-the-badge&logo=github)](https://woqhrl9494-cell.github.io/corridor-mapper/)
[![HTML5](https://img.shields.io/badge/HTML5-Single%20File-orange?style=for-the-badge&logo=html5)](https://woqhrl9494-cell.github.io/corridor-mapper/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

## 🎯 Overview

EchoMap simulates how a **bistatic radar** system can reconstruct corridor wall geometry without direct line-of-sight — a key challenge in search-and-rescue, autonomous navigation, and through-wall sensing.

Each vehicle acts as a moving radar node. As it travels through the corridor, the system accumulates **bistatic ellipses** from reflected signals. The intersection density of these ellipses reveals the underlying wall structure, which is then extracted via contour tracing and ridge detection.

---

## ✨ Features

- **Real-time ellipse accumulation** — visualize bistatic reflection geometry as vehicles move
- **Density gradient analysis** — grid-based hit density scoring with tunable threshold
- **Tangent coherence scoring** — wall candidacy ranked by local ellipse alignment
- **Ridge extraction** — automated corridor wall estimation from density peaks
- **Dual scenario support** — straight **Corridor** and curved **Torus** environments
- **Live metrics** — Precision, Recall, F1, Hausdorff distance, Wall Score
- **Zero dependencies** — pure HTML5 + Canvas, runs entirely in the browser

---

## 🚀 Live Demo

**[→ Try it now](https://woqhrl9494-cell.github.io/corridor-mapper/)**

No installation required. Open in any modern browser.

---

## 🖥️ How It Works

```
Vehicles move through corridor
        ↓
Each pair of Tx/Rx positions defines a bistatic ellipse
        ↓
Ellipses are accumulated on a 2D density grid
        ↓
High-density cells → wall candidates
        ↓
Coherence filtering → final wall estimate
```

### Algorithm Pipeline

| Stage | Description |
|-------|-------------|
| **Ellipse Generation** | For each radar hit, compute the bistatic ellipse from transmitter/receiver geometry |
| **Grid Accumulation** | Rasterize ellipses onto a spatial grid; count intersections per cell |
| **Density Gradient (A)** | Normalize grid → identify peak density regions |
| **Tangent Coherence (B)** | Score each cell by alignment of surrounding ellipse tangents |
| **Wall Score (A×B)** | Multiply density and coherence → ridge detection → final wall contour |

---

## 🎮 Controls

| Parameter | Description |
|-----------|-------------|
| **Seed** | Random environment seed |
| **Gap height** | Corridor width (meters) |
| **Roughness / Curvature** | Wall surface complexity |
| **Vehicle Count / Speed** | Number of moving radar nodes and their velocity |
| **Spread / Noise** | Measurement spread and signal noise level |
| **Alpha** | Ellipse transparency for accumulation visualization |
| **Grid G** | Spatial resolution of the density grid |
| **Threshold** | Minimum density for wall candidate selection |

---

## 📐 Scenarios

### Corridor
Straight-walled corridor with configurable roughness and curvature. Classic indoor sensing scenario.

### Torus
Curved toroidal corridor — tests the algorithm's robustness under non-linear wall geometry.

---

## 🛠️ Tech Stack

- **Vanilla HTML5 / CSS3 / JavaScript** — zero frameworks, zero dependencies
- **Canvas 2D API** — real-time rendering of ellipses, grids, and overlays
- **DM Sans + DM Mono** — Google Fonts for clean scientific UI

---

## 📊 Evaluation Metrics

| Metric | Description |
|--------|-------------|
| **Precision** | Fraction of estimated wall points near ground truth |
| **Recall** | Fraction of ground truth wall covered by estimate |
| **F1 Score** | Harmonic mean of precision and recall |
| **Wall Score** | Combined density × coherence score |
| **Chamfer Distance** | Mean bidirectional distance between estimated and true wall |
| **Hausdorff 95** | 95th percentile of max deviation |

---

## 👤 Author

**Jaebok Lee**
Hanyang University
📧 [ok7393@hanyang.ac.kr](mailto:ok7393@hanyang.ac.kr)

---

## 📄 License

This project is licensed under the MIT License.
