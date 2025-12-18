import json
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

# Example totals — replace these with the values computed in your JS script
totals = {
    "tp": 33,
    "fp": 0,
    "fn": 2,
    "tn": 43
}

# Create a 2×2 confusion matrix
matrix = np.array([[totals["tp"], totals["fn"]],
                   [totals["fp"], totals["tn"]]])

labels = ["Passed", "Failed"]

# --- Visualization setup ---
plt.figure(figsize=(8, 6))
ax = sns.heatmap(
    matrix,
    annot=True,
    fmt="d",
    cmap="Blues",
    linewidths=0.8,
    cbar_kws={'label': 'Num. of Rules'},
    square=True
)

# Axis labels
ax.set_xlabel("Detected verdict (Actual)", fontsize=12)
ax.set_ylabel("Ground truth (Expected)", fontsize=12)
ax.set_xticklabels(labels)
ax.set_yticklabels(labels, rotation=0)

# Title
plt.title("Rule-Level Compliance Detection Matrix", fontsize=14, weight="bold")

# Tight layout for clean edges
plt.tight_layout()

# Save as PNG or display directly
plt.savefig("confusion_matrix.png", dpi=300)
plt.show()