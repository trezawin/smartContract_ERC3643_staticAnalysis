import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# === 1. Load the Excel file ===
file_path = "/Users/treza/Documents/staticAnalysis/Viz/AMLO Rule Study (1).xlsx"  # Change path if needed
df = pd.read_excel(file_path, sheet_name="Sheet1")

# === 2. Clean and rename relevant columns ===
df = df.rename(columns={
    "Provision or schedule": "Clause",
    "Compliance objective": "Objective",
    "On chain feasibility": "Feasibility",
    "ERC-3643 (suggested modules / functions)": "ERC_Modules"
})

df["Feasibility"] = df["Feasibility"].str.strip().str.title()
# df["Severity"] = df["Severity"].replace({"Very High": "High"})

# === 3. Set chart styles ===
sns.set(style="whitegrid")
plt.rcParams["figure.figsize"] = (10, 6)

# === Plot 1: Feasibility Distribution ===
plt.figure()
sns.countplot(data=df, x="Feasibility", palette="tab10", order=df["Feasibility"].value_counts().index)
plt.title("Rule Feasibility Distribution")
plt.xlabel("Enforcement Type")
plt.ylabel("Number of Rules")
plt.xticks(rotation=15)
plt.tight_layout()
plt.savefig("feasibility_distribution.png", dpi=300)
plt.show()

# === Plot 2: Severity Distribution ===
plt.figure()
sns.countplot(data=df, x="Severity", palette="Set2", order=["High", "Medium", "Low"])
plt.title("Severity of Extracted Rules")
plt.xlabel("Severity Level")
plt.ylabel("Number of Rules")
plt.tight_layout()
plt.savefig("severity_distribution.png", dpi=300)
plt.show()

# === Plot 3: Heatmap – Severity vs Feasibility ===
heatmap_df = pd.crosstab(df["Feasibility"], df["Severity"])
plt.figure(figsize=(8, 4))  # smaller height to prevent label cutoff
sns.heatmap(heatmap_df, annot=True, fmt="d", cmap="YlGnBu", annot_kws={"fontsize": 9})
plt.title("Heatmap: Enforcement Type vs Severity")
plt.xlabel("Severity")
plt.ylabel("Feasibility")
plt.xticks(rotation=45, ha="right")
plt.yticks(rotation=0)
plt.tight_layout()
plt.savefig("heatmap_severity_vs_feasibility.png", dpi=300, bbox_inches="tight")
plt.show()

# === Plot 4: Coverage Funnel ===
total_rules = len(df)
on_chain_count = len(df[df["Feasibility"] == "On-Chain"])
hybrid_count = len(df[df["Feasibility"] == "Hybrid"])

funnel_df = pd.DataFrame({
    "Stage": ["Total Extracted", "On-chain Auditable", "Hybrid Auditable"],
    "Count": [total_rules, on_chain_count, hybrid_count]
})

plt.figure()
sns.barplot(data=funnel_df, x="Stage", y="Count", palette="Blues_d")
plt.title("Coverage Funnel: Extracted → Auditable Rules")
plt.ylabel("Number of Rules")
plt.tight_layout()
plt.savefig("coverage_funnel.png", dpi=300)
plt.show()

# === Plot 5: ERC-3643 Module Usage ===
erc_counts = df["ERC_Modules"].dropna()
erc_counts = erc_counts[erc_counts != "None"]
erc_summary = erc_counts.str.split(" \+ ").explode().value_counts()

if not erc_summary.empty:
    plt.figure(figsize=(10, 6))
    sns.barplot(x=erc_summary.values, y=erc_summary.index, palette="coolwarm")
    plt.title("Usage of ERC-3643 Suggested Modules")
    plt.xlabel("Count")
    plt.ylabel("ERC-3643 Module")
    plt.tight_layout()
    plt.savefig("erc_module_usage.png", dpi=300)
    plt.show()
else:
    print("No valid ERC-3643 module suggestions available to plot.")

# === Table: Rule Count Summary ===
summary_stats = df.groupby(["Feasibility", "Severity"]).size().unstack(fill_value=0)
summary_stats["Total"] = summary_stats.sum(axis=1)
summary_stats.loc["Total"] = summary_stats.sum()
print("\n=== Rule Count Summary Table ===")
print(summary_stats)

# === Visualization: Rule Count Summary (Color Chart) ===
plt.figure(figsize=(8, 5))
sns.heatmap(summary_stats.drop("Total", errors="ignore"), annot=True, cmap="crest", fmt="d", cbar=True)
plt.title("Rule Count Summary by Feasibility and Severity")
plt.xlabel("Severity Level")
plt.ylabel("Feasibility")
plt.tight_layout()
plt.savefig("rule_count_summary_heatmap.png", dpi=300, bbox_inches="tight")
plt.show()