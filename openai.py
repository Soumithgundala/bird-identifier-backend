import openai

openai.api_key = "your_openai_api_key"

def classify_bird(image_path):
    with open(image_path, "rb") as image_file:
        response = openai.ChatCompletion.create(
            model="gpt-4-turbo",
            messages=[
                {"role": "system", "content": "You are a bird species identification assistant."},
                {"role": "user", "content": "Identify the bird in this image."},
            ],
            files=[("image", image_file)]
        )
    return response["choices"][0]["message"]["content"]

bird_species = classify_bird("bird_image.jpg")
print("Identified Bird:", bird_species)
