module ParameterSanitization
  include Types

  def sanitize_order_dir(order_dir, default = nil)
    sanitized_order_dir = (order_dir || "").downcase.to_sym
    if [:desc, :asc].include?(sanitized_order_dir)
      return sanitized_order_dir
    end

    default
  end

  def sanitize_metadata_field_name(name, default = nil)
    MetadataField.where(name: name).exists? ? name : default
  end

  def sanitize_title_name(title)
    # Allow letters, numbers, underscores, dashes, and spaces
    title.gsub(/[^A-Za-z0-9_\- ]/, ' ').strip
  end

  def sanitize_accession_id(accession_id)
    if accession_id
      # Allow capital letters, numbers, underscores, and periods
      accession_id.gsub(/[^A-Z0-9_.]/, '')
    end
  end

  def sanitize_annotation_filters(annotation_filters)
    if annotation_filters
      annotation_filters.filter_map do |a|
        Annotation.contents[get_annotation_name(a)]
      end
    end
  end

  def parse_annotation_name(annotation_filter_hashlike)
    annotation_filter_hashlike = annotation_filter_hashlike.with_indifferent_access
    if annotation_filter_hashlike[:name]
      annotation_filter_hashlike[:name].downcase.parameterize(separator: '_')
    else
      raise StandardError, "annotation_filter is missing 'name'"
    end
  end

  def get_annotation_name(annotation_filter)
    case annotation_filter
    when String
      return parse_annotation_name(JSON.parse(annotation_filter))
    when Hash
      return parse_annotation_name(annotation_filter)
    when ActionController::Parameters
      return parse_annotation_name(annotation_filter.permit(:name).to_h)
    else
      # if annotation_filter.respond_to?(:name) && annotation_filter.name
      #   return annotation_filter.name.downcase.parameterize(separator: '_')
      raise StandardError, "annotation_filter has unknown Type [#{annotation_filter.class}]"
    end
  rescue StandardError => ex
    LogUtil.log_error(
      "Invalid annotation_filter [#{annotation_filter.class}]: #{annotation_filter&.inspect}",
      exception: ex,
      annotation_filter: annotation_filter&.inspect,
      annotation_filter_class: annotation_filter.class
    )
    nil
  end
end
