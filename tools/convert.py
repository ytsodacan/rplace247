from PIL import Image
import json
import datetime
import os
import tkinter as tk
from tkinter import filedialog, messagebox

def rgb_to_hex(rgb):
    """
    Converts an RGB tuple to a hexadecimal color string.

    Args:
        rgb (tuple): A tuple containing R, G, B integer values (e.g., (255, 255, 255)).

    Returns:
        str: A hexadecimal color string (e.g., "#FFFFFF").
    """
    # Ensure RGB values are integers and within the valid range [0, 255]
    r, g, b = max(0, min(255, int(rgb[0]))), max(0, min(255, int(rgb[1]))), max(0, min(255, int(rgb[2])))
    return f"#{r:02X}{g:02X}{b:02X}"

def image_to_grid_json(image_path, output_json_path, target_width=500, target_height=500):
    """
    Converts a 500x500 image into a grid of hexadecimal color codes and saves it as a JSON file.

    The JSON structure will be:
    {
      "timestamp": "ISO 8601 string",
      "version": "1.0",
      "gridWidth": 500,
      "gridHeight": 500,
      "data": [
        ["#RRGGBB", "#RRGGBB", ...],
        ["#RRGGBB", "#RRGGBB", ...],
        ...
      ]
    }

    Args:
        image_path (str): The path to the input image file.
        output_json_path (str): The path where the output JSON file will be saved.
        target_width (int): The desired width of the grid. Default is 500.
        target_height (int): The desired height of the grid. Default is 500.
    """
    try:
        # Open the image
        img = Image.open(image_path)

        # Resize the image to the target dimensions if it's not already
        if img.width != target_width or img.height != target_height:
            print(f"Resizing image from {img.width}x{img.height} to {target_width}x{target_height}...")
            img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)

        # Convert image to RGB mode if it's not already (e.g., for PNGs with alpha)
        img = img.convert("RGB")

        # Get pixel access object
        pixels = img.load()

        grid_data = []
        for y in range(img.height):
            row = []
            for x in range(img.width):
                # Get RGB tuple for the pixel
                rgb_color = pixels[x, y]
                # Convert RGB to hex and add to the row
                row.append(rgb_to_hex(rgb_color))
            grid_data.append(row)

        # Prepare the JSON structure
        json_output = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds'),
            "version": "1.0",
            "gridWidth": target_width,
            "gridHeight": target_height,
            "data": grid_data
        }

        # Save the JSON data to a file
        with open(output_json_path, 'w') as f:
            json.dump(json_output, f, indent=2)

        messagebox.showinfo("Success", f"Successfully converted '{os.path.basename(image_path)}' to '{os.path.basename(output_json_path)}'")
        print(f"Successfully converted '{image_path}' to '{output_json_path}'")

    except FileNotFoundError:
        messagebox.showerror("Error", f"Image file not found at '{image_path}'")
        print(f"Error: Image file not found at '{image_path}'")
    except Exception as e:
        messagebox.showerror("Error", f"An error occurred: {e}")
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    # Initialize Tkinter root window
    root = tk.Tk()
    root.withdraw()  # Hide the main window

    image_path = None
    try:
        # Open file explorer to select an image
        image_path = filedialog.askopenfilename(
            title="Select an image file",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif"), ("All files", "*.*")]
        )

        if not image_path:
            messagebox.showinfo("Cancelled", "No image file selected. Exiting.")
            print("No image file selected. Exiting.")
        else:
            output_json_filename = "output_grid_data.json"
            # Call the conversion function
            image_to_grid_json(image_path, output_json_filename)

    except ImportError:
        messagebox.showerror("Error", "Pillow library not found. Please install it using: pip install Pillow")
        print("Pillow library not found. Please install it using: pip install Pillow")
    except Exception as e:
        messagebox.showerror("Error", f"An unexpected error occurred: {e}")
        print(f"An unexpected error occurred: {e}")

    root.destroy() # Destroy the Tkinter root window after operations
