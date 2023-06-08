export OLDV=$1
export NEWV=$2
echo "Tagging workflows from v${OLDV} to v${NEWV}"
ls -lah
pwd
ls -lah .github
find .github -name "*.yml" -exec sed -E -i 's/\@v'$OLDV'/\@v'$NEWV'/g' {} \;
git status
git diff

