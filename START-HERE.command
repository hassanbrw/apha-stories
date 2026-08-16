#!/bin/bash
cd "$(dirname "$0")"
echo "  Claude khol raha hun. Likhna: START-HERE.md parho aur mujhe set up karo"
command -v claude >/dev/null && claude || { echo "  [X] claude nahi mila — pehle Claude Code install karo"; read; }
