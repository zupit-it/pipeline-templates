export OLDV=$1
export NEWV=$2
echo "Tagging workflows from v${OLDV} to v${NEWV}"
find .github -name "*.yml" -exec sed -E -i 's/\@v'$OLDV'/\@v'$NEWV'/g' {} \;
sed -E -i 's/\@v'$OLDV'/\@v'$NEWV'/g' README.md
