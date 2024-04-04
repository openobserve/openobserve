#! /bin/sh

npm run lint

rc=$?
if [ $rc -ne 0 ]; then
  echo "ES lint failed" >&2
  exit $rc
fi
