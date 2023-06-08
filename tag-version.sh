export OLDV=$1
export NEWV=$2
echo "Tagging workflows from ${OLDV} to ${NEWV}"
find .github -name "*.yml" -exec sed -E -i 's/\@'$OLDV'/\@'NEWV'/g' {} \;
