SRC_ALL = $(shell find $(SRC_DIR) -type f)
SRC_ALL_REL_PATH = $(patsubst $(SRC_DIR)/%,%,$(SRC_ALL))
SRC_DIR = src
OUT_DIR = out
MANIFEST_FILE = manifest.json

all: build_firefox build_chrome

build_firefox: $(SRC_ALL)
	cd $(SRC_DIR); \
	7z a ../$(OUT_DIR)/firefox.zip $(SRC_ALL_REL_PATH)

# chrome no longer allows manifest version 2. i don't use any version 
# incompatible feature, so just directly adjust the version when build
build_chrome: $(SRC_ALL)
	cd $(SRC_DIR); \
	7z a ../$(OUT_DIR)/chrome.zip $(SRC_ALL_REL_PATH); \
	cp $(MANIFEST_FILE) ../$(OUT_DIR)/; \
	cd ../$(OUT_DIR); \
	sed -i 's/"manifest_version": 2/"manifest_version": 3/' $(MANIFEST_FILE); \
	7z u chrome.zip $(MANIFEST_FILE)

clean:
	rm $(OUT_DIR)/*