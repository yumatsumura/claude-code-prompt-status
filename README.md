# prompt-status

Claude Code の入力欄のすぐ上に、セッションの状態を1行で表示する mod です。

```
claude-mods-sandbox │ ctx 23% (45k/200k) │ 5h 12.5% ↻14:00 · 7d 61% ↻10/28 9:00 │ Opus 5.5 · xhigh
```

## 表示する内容

| 項目 | 内容 |
| --- | --- |
| ディレクトリ名 | セッションを起動したディレクトリ（プロジェクトルート）の末尾の名前。`/cd` で移動すると更新されます |
| コンテキスト | 直近の応答時点の使用トークン数 / コンテキストウィンドウ。50% で黄、80% で赤になります。最初の応答までは `ctx --/200k` |
| 利用上限 | 5時間枠（5h）と7日枠（7d）の使用率とリセット時刻。最初の応答までは「送信後に表示」。サブスクリプション利用時のみ表示されます |
| モデル・エフォート | 実際に送ったリクエストのモデルとエフォート。送信前は settings.json の `modelSettings` → `effortLevel` から推定し、`/model` や `/effort` を実行するとすぐ反映されます |

## インストール

ターミナルの Claude Code のプロンプトで:

```
/plugin install prompt-status --marketplace yumatsumura/claude-code-prompt-status
```

マーケットプレイスの追加を聞かれたら `y`、続いてスコープを選びます（user を選ぶとすべてのセッションで有効になります）。

シェルから:

```
claude plugin install prompt-status --marketplace yumatsumura/claude-code-prompt-status
```

デスクトップアプリでは、プロンプト欄の横の + → Plugins → Add marketplace で `yumatsumura/claude-code-prompt-status` を追加し、Add plugin からインストールします。

## 無効化

```
claude plugin disable prompt-status@local-mods
```

## 開発

```
claude plugin validate .
claude plugin test .
```
