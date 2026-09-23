#!/usr/bin/env bash
# Transitional compatibility only. New configuration uses DFARMING_*.
dfarming_import_legacy_env() {
  local name suffix canonical value
  while IFS='=' read -r name value; do
    case "$name" in
      PHONE_FARM_*)
        suffix="${name#PHONE_FARM_}"
        canonical="DFARMING_${suffix}"
        if [[ -z "${!canonical+x}" ]]; then
          printf -v "$canonical" '%s' "$value"
          export "$canonical"
        fi
        ;;
    esac
  done < <(env)
}
