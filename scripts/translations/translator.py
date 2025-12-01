import json
import boto3
import os
from botocore.exceptions import NoCredentialsError

translate = boto3.client('translate')

def CreateOpenSourceTranslationFile(locale):
    """
    Create or update translation file for the specified locale.
    Only translates new keys, preserving existing translations.
    """
    # Convert en.json to target language dictionary, removing already translated items
    targetOutput = convertLocaleTo(locale)

    # Define the path for the target language file (e.g., fr.json, es.json)
    target_file_path = get_language_file_path(locale)

    # Check if the target language file exists
    if os.path.exists(target_file_path):
        # If it exists, load the current translations
        with open(target_file_path, "r", encoding="utf-8") as f:
            existing_translations = json.load(f)
        # Merge the existing translations with the new ones, skipping translation for existing values
        merged_translations = merge_translations(existing_translations, targetOutput)
    else:
        # If the file doesn't exist, use the new translations
        merged_translations = targetOutput

    # Write the merged translations back to the target file
    with open(target_file_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(merged_translations, indent=2, ensure_ascii=False))

    print(f"Translation file created/updated: {locale}.json")


def convertLocaleTo(locale):
    """
    Convert English locale to target locale, preserving existing translations.
    """
    newLocale = {}

    # Load the source (English) JSON file
    source_file_path = get_language_file_path('en')
    with open(source_file_path, encoding="utf-8") as f:
        data = json.load(f)

    target_file_path = get_language_file_path(locale)

    # Load existing target language translations (if the file exists)
    if os.path.exists(target_file_path):
        with open(target_file_path, "r", encoding="utf-8") as f:
            existing_translations = json.load(f)
    else:
        existing_translations = {}

    for section in data:
        newLocale[section] = translate_nested_object(
            data[section],
            existing_translations.get(section, {}),
            locale
        )

    return newLocale


def translate_nested_object(source_obj, existing_obj, locale):
    """
    Recursively translates nested objects.
    If a value is a string, translate it.
    If a value is a dict, recurse into it.
    """
    result = {}

    for key, value in source_obj.items():
        # Check if this key exists in existing translations
        if key in existing_obj:
            if isinstance(value, dict) and isinstance(existing_obj[key], dict):
                # Both are dicts, recurse to check for new nested keys
                result[key] = translate_nested_object(value, existing_obj[key], locale)
            else:
                # Key exists, keep the existing translation
                result[key] = existing_obj[key]
        else:
            # Key doesn't exist, need to translate
            if isinstance(value, dict):
                # It's a nested object, recurse
                result[key] = translate_nested_object(value, {}, locale)
            else:
                # It's a string, translate it
                result[key] = translate_text(value, locale)

    return result


def translate_text(text, locale):
    """
    Translate text using AWS Translate service.
    """
    try:
        translatedText = translate.translate_text(
            Text=text,
            SourceLanguageCode='en',
            TargetLanguageCode=locale
        )
        return translatedText['TranslatedText']
    except NoCredentialsError:
        print("ERROR: No credentials for the translation service.")
        print("Please configure AWS credentials with access to AWS Translate.")
        return text  # Fallback to the original text in case of an error
    except Exception as e:
        print(f"ERROR: Translation failed for text: {text}")
        print(f"Error: {str(e)}")
        return text


def merge_translations(existing_translations, new_translations):
    """
    Merges the existing translations with new translations.
    If a translation already exists, it skips translation.
    """
    for section, keys in new_translations.items():
        if section not in existing_translations:
            # If section doesn't exist, add it entirely
            existing_translations[section] = keys
        else:
            for key, value in keys.items():
                # Only add keys that don't already exist
                if key not in existing_translations[section]:
                    existing_translations[section][key] = value
    return existing_translations


def get_language_file_path(locale):
    """
    Get the absolute path to a language file.
    """
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Navigate to the language files directory
    languages_dir = os.path.join(script_dir, '..', '..', 'web', 'src', 'locales', 'languages')
    return os.path.join(languages_dir, f'{locale}.json')


def get_supported_languages():
    """
    Returns a list of supported language codes.
    """
    return ['tr', 'zh', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'nl']
