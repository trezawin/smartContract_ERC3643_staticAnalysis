import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd

# Prepare data
data = {
    'Dataset': ['T-REX', 'T-REX', 'Boulder', 'Boulder', 'Mutated', 'Mutated'],
    'Clarity': ['Clear', 'Partially Clear', 'Clear', 'Partially Clear', 'Clear', 'Partially Clear'],
    'Count': [5, 6, 9, 2, 3, 8]
}
df = pd.DataFrame(data)

# Custom color palette
palette = {
    'Clear': '#1D6996',           # custom blue
    'Partially Clear': '#E17C40'  # custom orange
}

# Create barplot
plt.figure(figsize=(7, 4))
sns.barplot(
    x='Dataset',
    y='Count',
    hue='Clarity',
    data=df,
    palette=palette
)

# Labels and aesthetics
plt.title("Clarity of AI-Generated Explanations by Dataset", fontsize=13)
plt.ylabel("Number of Explanations")
plt.xlabel("")
plt.ylim(0, 11)
plt.legend(title="Clarity", loc='upper right')
plt.tight_layout()
plt.show()