#!/usr/bin/env python3
"""
Translation Generator for OpenObserve
Generates translation files from en.json using AWS Translate service.

Usage:
    python main.py              # Translate all supported languages
    python main.py fr es de     # Translate specific languages
"""

import sys
from translator import CreateOpenSourceTranslationFile, get_supported_languages


def main():
    """
    Main function to generate translations.
    Can be run with specific language codes as arguments, or without arguments to translate all.
    """
    # Get supported languages
    supported_languages = get_supported_languages()

    # If specific languages are provided as arguments, use those
    if len(sys.argv) > 1:
        languages_to_translate = sys.argv[1:]
        # Validate provided languages
        invalid_languages = [lang for lang in languages_to_translate if lang not in supported_languages]
        if invalid_languages:
            print(f"WARNING: Unsupported language codes: {', '.join(invalid_languages)}")
            print(f"Supported languages: {', '.join(supported_languages)}")
            languages_to_translate = [lang for lang in languages_to_translate if lang in supported_languages]
    else:
        # No arguments provided, translate all supported languages
        languages_to_translate = supported_languages

    if not languages_to_translate:
        print("ERROR: No valid languages to translate.")
        sys.exit(1)

    print(f"Starting translation for: {', '.join(languages_to_translate)}")
    print("-" * 60)

    # Translate each language
    for locale in languages_to_translate:
        print(f"\nTranslating: {locale}")
        try:
            CreateOpenSourceTranslationFile(locale)
        except Exception as e:
            print(f"ERROR: Failed to translate {locale}: {str(e)}")
            continue

    print("\n" + "-" * 60)
    print(f"Translation complete! Processed {len(languages_to_translate)} language(s).")


if __name__ == "__main__":
    main()
