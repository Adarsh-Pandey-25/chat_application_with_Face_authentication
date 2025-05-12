import face_recognition
import cv2
import os
import sys
import logging
import numpy as np
import gc
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import io
from PIL import Image

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
FACES_DIR = "face_recognition/known_faces"
PORT = int(os.environ.get('PORT', 5001))  # Railway sets PORT automatically
RAILWAY_STATIC_URL = os.environ.get('RAILWAY_STATIC_URL', '')  # Railway's static URL
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '*')  # For CORS
TOLERANCE = 1.0  # Face recognition tolerance

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}})  # Enable CORS for all routes

# Global variables to store face encodings
known_encodings = []
known_names = []

def cleanup_image(image):
    """Helper function to cleanup image resources"""
    try:
        if image is not None:
            del image
            gc.collect()
    except Exception as e:
        logger.error(f"Error cleaning up image: {str(e)}")

def load_known_faces():
    """Load known faces at startup"""
    global known_encodings, known_names
    
    if not os.path.exists(FACES_DIR):
        os.makedirs(FACES_DIR, exist_ok=True)
        logger.warning(f"Created known faces directory at {FACES_DIR}")
        return

    logger.info(f"Loading known faces from {FACES_DIR}")
    for file in os.listdir(FACES_DIR):
        if file.lower().endswith(('.jpg', '.jpeg')):
            name = os.path.splitext(file)[0].replace("known_face_", "").replace("_", " ").title()
            path = os.path.join(FACES_DIR, file)
            
            try:
                logger.debug(f"Processing file: {file}")
                image = face_recognition.load_image_file(path)
                
                # Try to detect faces first
                face_locations = face_recognition.face_locations(image)
                if not face_locations:
                    logger.warning(f"No face detected in reference image {file}")
                    cleanup_image(image)
                    continue
                    
                encoding = face_recognition.face_encodings(image, face_locations)
                if encoding:
                    known_encodings.append(encoding[0])
                    known_names.append(name)
                    logger.info(f"Successfully loaded face: {name}")
                else:
                    logger.warning(f"Could not encode face in {file}")
                
                cleanup_image(image)
                
            except Exception as e:
                logger.error(f"Error loading {file}: {str(e)}")
                cleanup_image(image)
    
    logger.info(f"Total known faces loaded: {len(known_names)}")
    logger.debug(f"Known names: {known_names}")

@app.route('/', methods=['GET'])
def home():
    """Home route for health check"""
    return jsonify({
        'status': 'ok',
        'message': 'Face Recognition Server is running',
        'known_faces': len(known_names)
    })

@app.route('/verify-face', methods=['POST'])
def verify_face():
    """Handle face verification requests"""
    logger.info("Received face verification request")
    
    if 'image' not in request.files:
        logger.error("No image provided in request")
        return jsonify({'error': 'No image provided'}), 400
    
    image = None
    try:
        # Get the image file from the request
        image_file = request.files['image']
        logger.debug(f"Received image: {image_file.filename}")
        
        # Read the image file
        image = face_recognition.load_image_file(image_file)
        logger.debug("Successfully loaded image file")
        
        # Find faces in the image
        face_locations = face_recognition.face_locations(image)
        logger.debug(f"Found {len(face_locations)} faces in the image")
        
        if not face_locations:
            logger.warning("No face detected in the uploaded image")
            cleanup_image(image)
            return jsonify({'error': 'No face detected in the image'}), 400
        
        # Get the encoding of the first face found
        face_encoding = face_recognition.face_encodings(image, face_locations)[0]
        logger.debug("Generated face encoding for uploaded image")
        
        if not known_encodings:
            logger.error("No known faces available for comparison")
            cleanup_image(image)
            return jsonify({'error': 'No known faces available'}), 500
        
        # Compare the face with known faces
        logger.debug("Comparing face with known faces...")
        matches = face_recognition.compare_faces(known_encodings, face_encoding, tolerance=TOLERANCE)
        # Calculate face distances
        face_distances = face_recognition.face_distance(known_encodings, face_encoding)
        logger.debug(f"Face distances: {face_distances}")
        
        if True in matches:
            best_match_index = np.argmin(face_distances)
            if matches[best_match_index]:
                name = known_names[best_match_index]
                confidence = 1 - face_distances[best_match_index]
                logger.info(f"Face recognized as: {name} with confidence: {confidence:.2%}")
                cleanup_image(image)
                return jsonify({
                    'success': True,
                    'user': name,
                    'confidence': float(confidence)
                })
        
        # If no match or confidence too low
        logger.warning("Face not recognized in known faces")
        cleanup_image(image)
        return jsonify({'error': 'Face not recognized'}), 401
            
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        if image is not None:
            cleanup_image(image)
        return jsonify({'error': 'Error processing image'}), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Face recognition server is running'})

if __name__ == '__main__':
    logger.info(f"Starting face authentication server on port {PORT}")
    # Load known faces at startup
    load_known_faces()
    if not known_encodings:
        logger.warning("No known faces were loaded at startup!")
    
    # Run the Flask app - Railway requires 0.0.0.0 host
    app.run(host='0.0.0.0', port=PORT)

#python3.11 login_with_face.py
