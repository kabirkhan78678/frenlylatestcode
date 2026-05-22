import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export async function getLocation(lat, lng) {
    // ✅ Guard clause
    if (!lat || !lng) {
        return null;
    }

    try {
        const apiKey = process.env.GOOGLE_API_KEY;

        const response = await axios.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            {
                params: {
                    latlng: `${lat},${lng}`,
                    key: apiKey,
                },
            }
        );

        if (response.data.status !== "OK") {
            return null; // ❌ throw mat karo
        }

        const addressComponents =
            response.data.results[0]?.address_components || [];

        let city = null;
        let country = null;

        for (const component of addressComponents) {
            if (
                component.types.includes("locality") ||
                component.types.includes("postal_town")
            ) {
                city = component.long_name;
            } else if (component.types.includes("country")) {
                country = component.long_name;
            }
        }

        return { city, country };

    } catch (error) {
        console.log("Google API error:", error.response?.data || error.message);
        return null; // ✅ never crash
    }
}