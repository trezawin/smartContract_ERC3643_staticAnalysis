import matplotlib.pyplot as plt

# Metrics and their scores
metrics = ['Faithfulness (Accuracy)', 'Contextual Relevancy (Clarity)']
scores = [0.982, 0.766]

# Set up the plot
plt.figure(figsize=(8, 3))
bars = plt.barh(metrics, scores, color=['#D3D3D3', 'light purple'], height=0.5)

# Annotate bars with score values
for bar in bars:
    plt.text(bar.get_width() + 0.01, bar.get_y() + bar.get_height()/2,
             f"{bar.get_width():.2f}", va='center', fontsize=10)

# Styling
plt.xlim(0, 1.1)
plt.xlabel("Score (0–1)")
plt.title("Explanation Quality Scores across AI-Generated Audit Outputs")
plt.tight_layout()

# Save the figure
plt.savefig("explanation_quality_scores.png", dpi=300)
plt.show()