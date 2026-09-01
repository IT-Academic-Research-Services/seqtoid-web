json.extract! @background, :id, :name, :description, :mass_normalized, :ready, :created_at, :updated_at
json.editable @editable
json.sample_count @samples.size
json.samples @samples do |sample|
  json.id sample.id
  json.name sample.name
  json.project_name sample.project&.name
end
