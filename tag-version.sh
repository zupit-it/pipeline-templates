export OLDV=$1
export NEWV=$2
echo "Tagging workflows from v${OLDV} to v${NEWV}"
find .github -name "*.yml" -exec sed -E -i 's/\@v'$OLDV'/\@v'$NEWV'/g' {} \;
git commit -am "chore(release): tag all workflows with new version $NEWV"
git push
