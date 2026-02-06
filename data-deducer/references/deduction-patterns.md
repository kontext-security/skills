# Deduction Patterns

Examples of the kind of non-obvious insights that make data analysis valuable. Read this after profiling, before forming hypotheses.

## Pattern: Hidden Structure in Strings

A column looks like plain text but contains parseable structure.

**Profile observation**: String column with high variance in length, or many values containing `{`, `,`, or `:`
**Good deduction**: "This JSON column has 68 unique values across 692 rows — what are the distinct capability profiles, and how do clients cluster by them?"
**Bad deduction**: "Let me count the unique values" (the profile already said this)

## Pattern: Power Law with Meaningful Tail

A few values dominate, but the long tail tells the real story.

**Profile observation**: Top 5 values account for >40% of rows
**Good deduction**: "The head is obvious (everyone knows Cursor is popular). What's interesting is the tail — which niche clients have the richest capabilities despite low adoption?"
**Bad deduction**: "Here are the top 10 most common values" (just restating the profile)

## Pattern: Temporal Signal Hidden in Snapshots

Data that looks static actually encodes time.

**Profile observation**: A date column, or version strings with dates embedded
**Good deduction**: "Version strings like `2025.12.1.12885` encode release dates. Can we reconstruct a release timeline and find bursts of activity?"
**Bad deduction**: "The dates range from X to Y" (the profile already said this)

## Pattern: Cross-Column Correlation

Two columns that seem independent actually tell a combined story.

**Profile observation**: One column has high cardinality, another has moderate cardinality
**Good deduction**: "Do clients with more version churn (many versions) also tend to have richer capability declarations? Is maturity correlated with feature adoption?"
**Bad deduction**: "Let me look at each column separately" (misses the relationship)

## Pattern: Absence as Signal

What's NOT in the data is more interesting than what is.

**Profile observation**: A JSON column where most values are `{}`
**Good deduction**: "53% of clients declare empty capabilities. Are they lazy, or is empty-capabilities the norm for a specific client category (test tools, health checks, gateways)?"
**Bad deduction**: "Many values are empty" (observation without reasoning)

## Anti-Patterns to Avoid

- **Restating the profile**: "There are 692 rows and 4 columns" — the user can see this
- **Generic statistics**: "The mean is X, the standard deviation is Y" — meaningless without context
- **Listing without reasoning**: Showing a bar chart of value counts with no interpretation
- **Treating all columns equally**: Spending equal time on every column instead of following the most interesting thread
- **Shallow breadth over focused depth**: 10 surface-level observations vs 3 genuinely surprising findings
