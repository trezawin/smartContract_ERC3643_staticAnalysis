import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd

sns.set(style="whitegrid")

data = {
    "Criterion": [
        "Correctness", "Correctness", "Correctness",
        "Clarity", "Clarity", "Clarity"
    ],
    "Rating": [
        "Correct", "Partially Correct", "Incorrect",
        "Clear", "Partially Clear", "Unclear"
    ],
    "Count": [26, 4, 0, 25, 5, 0]
}

df = pd.DataFrame(data)

happy_palette = ["#FFD700", "#ADFF2F", "#98FB98", "#32CD32", "#9ACD32", "#FFFF99"]

# Group and sum counts for each rating under each criterion
correctness_df = df[df['Criterion'] == 'Correctness'].set_index('Rating')['Count']
clarity_df = df[df['Criterion'] == 'Clarity'].set_index('Rating')['Count']

# Prepare colors for each rating using happy palette cyclically
correctness_colors = [happy_palette[i % len(happy_palette)] for i in range(len(correctness_df))]
clarity_colors = [happy_palette[i % len(happy_palette)] for i in range(len(clarity_df))]

fig, axes = plt.subplots(1, 2, figsize=(8, 4))

def make_autopct(values):
    def my_autopct(pct):
        return ('%1.1f%%' % pct) if pct > 0 else ''
    return my_autopct

# Pie chart for Correctness with labels and percentages inside slices
wedges1, texts1, autotexts1 = axes[0].pie(
    correctness_df,
    labels=correctness_df.index,
    colors=correctness_colors,
    autopct=make_autopct(correctness_df),
    startangle=90,
    pctdistance=0.75,
    labeldistance=0.5,
    textprops={'fontsize':8, 'weight':'bold'}
)
axes[0].set_title('Expert Evaluation of Rule Correctness', fontsize=8, weight='bold')
for autotext in autotexts1:
    autotext.set_fontsize(8)
    autotext.set_weight('bold')

# Pie chart for Clarity with labels and percentages inside slices
wedges2, texts2, autotexts2 = axes[1].pie(
    clarity_df,
    labels=clarity_df.index,
    colors=clarity_colors,
    autopct=make_autopct(clarity_df),
    startangle=90,
    pctdistance=0.75,
    labeldistance=0.5,
    textprops={'fontsize':8, 'weight':'bold'}
)
axes[1].set_title('Expert Evaluation of Rule Clarity', fontsize=8, weight='bold')
for autotext in autotexts2:
    autotext.set_fontsize(8)
    autotext.set_weight('bold')

plt.tight_layout()
plt.show()