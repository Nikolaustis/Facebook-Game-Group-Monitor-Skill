import pandas as pd
import os

# 路径
src = r"C:\Users\Og\AppData\Local\Temp\ogteammate-composer-upload\充值订单导出-2026-04-27-1780901626368-c78a54.xlsx"
out = os.path.join(os.path.dirname(__file__), "渠道_商品规格_收入统计.csv")

# 读取
df = pd.read_excel(src)
print(f"总行数: {len(df)}")
print(f"列名: {list(df.columns)}")
print(f"\n商品规格样例: {df['商品规格'].dropna().unique()[:20]}")

# 按商品规格分组，统计订单金额总和
stats = df.groupby("商品规格", as_index=False)["订单金额"].sum()
stats.columns = ["商品规格（渠道）", "总收入"]
stats = stats.sort_values("总收入", ascending=False).reset_index(drop=True)

# 输出
stats.to_csv(out, index=False, encoding="utf-8-sig")
print(f"\n=== 统计结果（前20）===")
print(stats.head(20).to_string(index=False))
print(f"\n总记录数: {len(stats)}")
print(f"已保存: {out}")
