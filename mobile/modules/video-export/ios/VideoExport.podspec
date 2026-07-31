Pod::Spec.new do |s|
  s.name           = 'VideoExport'
  s.version        = '1.0.0'
  s.summary        = 'Renders a timeline composition with AVFoundation'
  s.license        = 'MIT'
  s.author         = 'Theorvane'
  s.homepage       = 'https://github.com/Theorvane/openvideo'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
end
