- A simple, interactive webpage in three parts: style.css, index.html, script.js
- No JS frameworks

This app displays a grid of rounded square "cards." There are four sizes:

Size 1: 4x3
Size 2: 4x4
Size 3: 5x4
Size 4: 6x4

Each set of cards contains one wild card (!), one free card (\*), and the rest are pairs (AA, BB, CC, etc).

Each size has several configurations. These should be stored as lists and easy for me to create new layouts. Here are two example layouts for a 4x4 grid:

AA!G
BC\*G
BCEE
DDFF

AA!\*
BBEG
CCEG
DDFF

Each letter (A-K) should have a unique color.

After selecting the Size and Layout, the user should be able to swap any two card positions by clicking on them.
