/**
 * VULANET BUTTON SYSTEM - JavaScript Component
 * Create buttons programmatically with consistent styling
 */

export class VulanetButton {
  constructor(options = {}) {
    this.text = options.text || 'Button';
    this.type = options.type || 'carpenter-blue'; // carpenter-blue, belly-blue, cloud, gecko, ladybug, bee, tiger, beetle, boa
    this.size = options.size || 'md'; // sm, md, lg
    this.disabled = options.disabled || false;
    this.icon = options.icon || null; // Phosphor icon class, e.g., 'ph-arrow-right'
    this.onClick = options.onClick || null;
    this.fullWidth = options.fullWidth !== undefined ? options.fullWidth : true;
    this.id = options.id || null;
  }
  
  render() {
    const button = document.createElement('button');
    button.className = `btn btn-${this.type} btn-${this.size}`;
    
    if (this.disabled) {
      button.disabled = true;
    }
    
    if (this.fullWidth) {
      button.style.width = '100%';
    }
    
    if (this.id) {
      button.id = this.id;
    }
    
    if (this.icon) {
      const iconSpan = document.createElement('i');
      iconSpan.className = this.icon;
      button.appendChild(iconSpan);
    }
    
    const textSpan = document.createElement('span');
    textSpan.textContent = this.text;
    button.appendChild(textSpan);
    
    if (this.onClick) {
      button.addEventListener('click', this.onClick);
    }
    
    return button;
  }
  
  static createButton(options) {
    const btn = new VulanetButton(options);
    return btn.render();
  }
  
  static enableButton(buttonElement) {
    if (buttonElement) {
      buttonElement.disabled = false;
      buttonElement.classList.remove('disabled');
    }
  }
  
  static disableButton(buttonElement) {
    if (buttonElement) {
      buttonElement.disabled = true;
      buttonElement.classList.add('disabled');
    }
  }
}

// Usage example:
// const continueBtn = VulanetButton.createButton({
//   text: 'CONTINUE',
//   type: 'carpenter-blue',
//   size: 'md',
//   disabled: true,
//   onClick: () => console.log('Continue clicked')
// });
